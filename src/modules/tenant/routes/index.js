'use strict';

const { Router } = require('express');
const { authenticateToken } = require('../../../../middleware/auth');
const FeatureFlagService       = require('../../../services/FeatureFlagService');
const IntegrationConfigService = require('../../../services/IntegrationConfigService');
const ViewResolver             = require('../../../services/ViewResolver');
const { TenantCustomField }    = require('../../../models');
const lifecycle                = require('../controller/TenantLifecycleController');

const router = Router({ mergeParams: true });

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// ── Lifecycle (solo superadmin / platform admin) ───────────────────────────────

// GET  /api/admin/tenants
router.get('/', lifecycle.list);

// GET  /api/admin/tenants/stats  — lista con contadores (para el panel super admin)
router.get('/stats', lifecycle.listWithStats);

// GET  /api/admin/tenants/import-sections  — secciones disponibles para CSV import
router.get('/import-sections', lifecycle.getSections);

// GET  /api/admin/tenants/template-csv/:section  — descarga plantilla CSV con BOM
router.get('/template-csv/:section', (req, res) => {
  const importSvc = require('../../../services/TenantImportService');
  const sections  = importSvc.getSections();
  const sec       = sections[req.params.section];
  if (!sec) return res.status(404).json({ error: 'Sección no encontrada' });
  const filename  = `plantilla_${req.params.section}.csv`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.end('﻿' + sec.template);
});

// POST /api/admin/tenants  { name, slug?, plan?, domain?, contactEmail? }
router.post('/', lifecycle.create);

// ── Platform health ───────────────────────────────────────────────────────────
// GET /api/admin/tenants/health
router.get('/health', async (req, res, next) => {
  try {
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    const start = Date.now();
    let dbOk = false; let dbMs = null;
    try {
      await executeQuery(equipmentPool, 'SELECT 1');
      dbOk = true; dbMs = Date.now() - start;
    } catch (_) {}

    const mem  = process.memoryUsage();
    const upSec = Math.floor(process.uptime());
    const upStr = upSec < 60 ? `${upSec}s`
                : upSec < 3600 ? `${Math.floor(upSec/60)}m ${upSec%60}s`
                : `${Math.floor(upSec/3600)}h ${Math.floor((upSec%3600)/60)}m`;

    // Últimos 5 errores registrados (si hay tabla audit_logs)
    let recentErrors = [];
    try {
      recentErrors = await executeQuery(equipmentPool,
        `SELECT action, details, created_at FROM audit_logs
         WHERE action LIKE '%error%' OR action LIKE '%fail%'
         ORDER BY created_at DESC LIMIT 5`);
    } catch (_) {}

    // Conteo global
    const [counts] = await executeQuery(equipmentPool,
      `SELECT
         (SELECT COUNT(*) FROM tenants WHERE is_active=1) AS tenants_active,
         (SELECT COUNT(*) FROM users   WHERE is_active=1 AND deleted_at IS NULL) AS users_active,
         (SELECT COUNT(*) FROM tickets WHERE created_at >= DATE_SUB(NOW(),INTERVAL 7 DAY) AND deleted_at IS NULL) AS tickets_week`
    ).catch(() => [{ tenants_active:0, users_active:0, tickets_week:0 }]);

    res.ok({
      db:   { ok: dbOk, latencyMs: dbMs },
      node: { uptimeStr: upStr, uptimeSec: upSec,
              memUsedMb: Math.round(mem.heapUsed/1024/1024),
              memTotalMb: Math.round(mem.heapTotal/1024/1024),
              rss: Math.round(mem.rss/1024/1024) },
      platform: counts || {},
      recentErrors,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) { next(e); }
});

// ── Actividad por tenant (últimos 7 y 30 días) ────────────────────────────────
// GET /api/admin/tenants/activity
router.get('/activity', async (req, res, next) => {
  try {
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    const rows = await executeQuery(equipmentPool,
      `SELECT
         t.id, t.name, t.plan,
         COUNT(DISTINCT CASE WHEN tk.created_at >= DATE_SUB(NOW(),INTERVAL 7  DAY) THEN tk.id END) AS tickets_7d,
         COUNT(DISTINCT CASE WHEN tk.created_at >= DATE_SUB(NOW(),INTERVAL 30 DAY) THEN tk.id END) AS tickets_30d,
         COUNT(DISTINCT CASE WHEN tk.status IN ('resuelto','cerrado') AND tk.updated_at >= DATE_SUB(NOW(),INTERVAL 30 DAY) THEN tk.id END) AS resolved_30d,
         COUNT(DISTINCT CASE WHEN u.created_at >= DATE_SUB(NOW(),INTERVAL 30 DAY) AND u.deleted_at IS NULL THEN u.id END) AS new_users_30d,
         COUNT(DISTINCT CASE WHEN u.is_active=1 AND u.deleted_at IS NULL THEN u.id END) AS total_users
       FROM tenants t
       LEFT JOIN tickets tk ON tk.tenant_id = t.id AND tk.deleted_at IS NULL
       LEFT JOIN users   u  ON u.tenant_id  = t.id
       WHERE t.is_active = 1
       GROUP BY t.id ORDER BY tickets_7d DESC`
    );
    res.ok(rows);
  } catch (e) { next(e); }
});

// ── Broadcast (comunicado global) ────────────────────────────────────────────
// POST /api/admin/broadcast  { title, body, tenantIds? }
router.post('/broadcast', async (req, res, next) => {
  try {
    const { title, body, tenantIds } = req.body;
    if (!title || !body) return res.fail('title y body son requeridos', 400);

    const { executeQuery, equipmentPool } = require('../../../../config/database');
    let targets;
    if (tenantIds && tenantIds.length) {
      targets = tenantIds.map(id => parseInt(id)).filter(Boolean);
    } else {
      const rows = await executeQuery(equipmentPool, 'SELECT id FROM tenants WHERE is_active=1');
      targets = rows.map(r => r.id);
    }

    for (const tid of targets) {
      await executeQuery(equipmentPool,
        `INSERT INTO portal_announcements (title, body, author_email, author_name, pinned, active, tenant_id)
         VALUES (?,?,?,?,0,1,?)`,
        [title, body, 'admin@plataforma.local', 'Super Administrador', tid]
      ).catch(() => {});
    }

    res.ok({ sent: targets.length }, `Comunicado enviado a ${targets.length} cliente(s)`);
  } catch (e) { next(e); }
});

// ── Billing por tenant ────────────────────────────────────────────────────────
// Auto-create tabla tenant_billing al primer uso
async function ensureBillingTable() {
  try {
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    await executeQuery(equipmentPool, `
      CREATE TABLE IF NOT EXISTS tenant_billing (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id    INT NOT NULL,
        renewal_date DATE,
        amount       DECIMAL(10,2),
        currency     VARCHAR(10) DEFAULT 'USD',
        status       ENUM('paid','pending','overdue') DEFAULT 'pending',
        notes        TEXT,
        created_at   DATETIME DEFAULT NOW(),
        updated_at   DATETIME DEFAULT NOW() ON UPDATE NOW(),
        INDEX idx_tenant  (tenant_id),
        INDEX idx_renewal (renewal_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } catch (_) {}
}
ensureBillingTable();

// GET  /api/admin/tenants/:tenantId/billing
router.get('/:tenantId/billing', async (req, res, next) => {
  try {
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    const rows = await executeQuery(equipmentPool,
      'SELECT * FROM tenant_billing WHERE tenant_id=? ORDER BY renewal_date DESC LIMIT 24',
      [parseInt(req.params.tenantId)]);
    res.ok(rows);
  } catch (e) { next(e); }
});

// POST /api/admin/tenants/:tenantId/billing
router.post('/:tenantId/billing', async (req, res, next) => {
  try {
    const { renewal_date, amount, currency, status, notes } = req.body;
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    await executeQuery(equipmentPool,
      `INSERT INTO tenant_billing (tenant_id, renewal_date, amount, currency, status, notes)
       VALUES (?,?,?,?,?,?)`,
      [parseInt(req.params.tenantId), renewal_date || null, amount || null,
       currency || 'USD', status || 'pending', notes || null]);
    res.ok(null, 'Registro creado', 201);
  } catch (e) { next(e); }
});

// PATCH /api/admin/tenants/:tenantId/billing/:billingId
router.patch('/:tenantId/billing/:billingId', async (req, res, next) => {
  try {
    const { renewal_date, amount, currency, status, notes } = req.body;
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    await executeQuery(equipmentPool,
      `UPDATE tenant_billing SET
         renewal_date=COALESCE(?,renewal_date), amount=COALESCE(?,amount),
         currency=COALESCE(?,currency), status=COALESCE(?,status),
         notes=COALESCE(?,notes), updated_at=NOW()
       WHERE id=? AND tenant_id=?`,
      [renewal_date||null, amount||null, currency||null, status||null, notes||null,
       parseInt(req.params.billingId), parseInt(req.params.tenantId)]);
    res.ok(null, 'Registro actualizado');
  } catch (e) { next(e); }
});

// DELETE /api/admin/tenants/:tenantId/billing/:billingId
router.delete('/:tenantId/billing/:billingId', async (req, res, next) => {
  try {
    const { executeQuery, equipmentPool } = require('../../../../config/database');
    await executeQuery(equipmentPool,
      'DELETE FROM tenant_billing WHERE id=? AND tenant_id=?',
      [parseInt(req.params.billingId), parseInt(req.params.tenantId)]);
    res.ok(null, 'Registro eliminado');
  } catch (e) { next(e); }
});

// DELETE /api/admin/tenants/:tenantId  { password }  — elimina cliente (requiere contraseña superadmin)
router.delete('/:tenantId', async (req, res, next) => {
  try {
    const tenantId = parseInt(req.params.tenantId);
    if (tenantId === 1) return res.fail('No se puede eliminar el tenant principal', 403);

    const { password } = req.body;
    if (!password) return res.fail('Se requiere la contraseña del administrador', 400);

    const bcrypt                           = require('bcrypt');
    const { executeQuery, equipmentPool }  = require('../../../../config/database');

    // Verificar contraseña del superadmin autenticado
    const [admin] = await executeQuery(equipmentPool,
      'SELECT password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.user.id]);
    if (!admin) return res.fail('Sesión inválida', 401);

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.fail('Contraseña incorrecta', 401);

    // Verificar que el tenant existe
    const [tenant] = await executeQuery(equipmentPool,
      'SELECT id, name FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
    if (!tenant) return res.fail('Cliente no encontrado', 404);

    const tenantName = tenant.name;

    // Desactivar usuarios del tenant
    await executeQuery(equipmentPool,
      'UPDATE users SET is_active = 0, deleted_at = NOW(), updated_at = NOW() WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId]);

    // Eliminar feature flags del tenant
    await executeQuery(equipmentPool,
      'DELETE FROM tenant_feature_flags WHERE tenant_id = ?',
      [tenantId]).catch(() => {});

    // Eliminar comunidades y miembros del tenant
    await executeQuery(equipmentPool,
      'DELETE FROM portal_community_members WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await executeQuery(equipmentPool,
      'DELETE FROM portal_communities WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await executeQuery(equipmentPool,
      'DELETE FROM portal_announcements WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await executeQuery(equipmentPool,
      'DELETE FROM faq_items WHERE tenant_id = ?', [tenantId]).catch(() => {});

    // Eliminar el tenant
    await executeQuery(equipmentPool,
      'DELETE FROM tenants WHERE id = ?', [tenantId]);

    res.ok(null, `Cliente "${tenantName}" eliminado exitosamente`);
  } catch (e) { next(e); }
});

// GET /api/admin/tenants/:tenantId/provision  — SSE provisioning stream
router.get('/:tenantId/provision', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
    });
    const send = (step, pct, msg, done = false) =>
        res.write(`data: ${JSON.stringify({ step, pct, msg, done })}\n\n`);

    try {
        const tenantId = parseInt(req.params.tenantId);
        const { executeQuery, equipmentPool } = require('../../../../config/database');

        send(1, 5,  'Verificando cliente...');
        const [tenant] = await executeQuery(equipmentPool, 'SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
        if (!tenant) { send(0, 100, 'Tenant no encontrado', true); return res.end(); }

        send(2, 20, 'Inicializando tablas de comunidades...');
        for (const tbl of ['portal_communities','portal_community_members','portal_join_requests']) {
            await executeQuery(equipmentPool,
                `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS tenant_id INT NOT NULL DEFAULT 1`
            ).catch(() => {});
        }

        send(3, 40, 'Creando comunidad inicial...');
        const existing = await executeQuery(equipmentPool,
            'SELECT id FROM portal_communities WHERE tenant_id = ? LIMIT 1', [tenantId]);
        if (!existing.length) {
            await executeQuery(equipmentPool,
                `INSERT INTO portal_communities (nombre, descripcion, created_by, created_name, active, tenant_id)
                 VALUES (?,?,?,?,1,?)`,
                [`General · ${tenant.name}`, 'Canal general del equipo TI',
                 tenant.contact_email || 'admin@plataforma.local', 'Sistema', tenantId]
            );
            const [newComm] = await executeQuery(equipmentPool,
                'SELECT id FROM portal_communities WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [tenantId]);
            if (newComm) {
                await executeQuery(equipmentPool,
                    `INSERT INTO portal_community_members (community_id, email, name, role, tenant_id) VALUES (?,?,?,'admin',?)`,
                    [newComm.id, tenant.contact_email || 'admin@plataforma.local', 'Administrador', tenantId]
                );
            }
        }

        send(4, 58, 'Configurando preguntas frecuentes...');
        const existingFaq = await executeQuery(equipmentPool,
            'SELECT id FROM faq_items WHERE tenant_id = ? LIMIT 1', [tenantId]);
        if (!existingFaq.length) {
            await executeQuery(equipmentPool,
                `INSERT INTO faq_items (tenant_id, category, question, answer, order_num, active, visible) VALUES
                 (?,?,?,?,1,1,1),(?,?,?,?,2,1,1),(?,?,?,?,3,1,1)`,
                [tenantId, 'General', '¿Cómo registro una incidencia?',
                 'Desde el portal, haz clic en "Generar Incidencia" y completa el formulario.',
                 tenantId, 'General', '¿Cuánto tarda en resolverse mi ticket?',
                 'Depende de la prioridad: P1/P2 → 4 horas, P3 → 24 horas, P4 → 72 horas.',
                 tenantId, 'Equipos', '¿Qué hago si mi equipo no enciende?',
                 'Reporta la incidencia indicando el código de tu equipo. Un técnico te contactará.']
            );
        }

        send(5, 74, 'Publicando anuncio de bienvenida...');
        const existingAnn = await executeQuery(equipmentPool,
            'SELECT id FROM portal_announcements WHERE tenant_id = ? LIMIT 1', [tenantId]);
        if (!existingAnn.length) {
            await executeQuery(equipmentPool,
                `INSERT INTO portal_announcements (title, body, author_email, author_name, pinned, active, tenant_id)
                 VALUES (?,?,?,?,1,1,?)`,
                [`¡Bienvenido al Portal TI de ${tenant.name}!`,
                 `Aquí puedes registrar incidencias, hacer seguimiento de tus equipos y consultar la base de conocimiento. ¡Estamos para ayudarte!`,
                 'admin@plataforma.local', 'Equipo TI', tenantId]
            );
        }

        send(6, 82, 'Aplicando configuración base...');
        const FeatureFlagService = require('../../../services/FeatureFlagService');
        await FeatureFlagService.set(tenantId, 'portal',      true,  {}).catch(() => {});
        await FeatureFlagService.set(tenantId, 'jira',        false, {}).catch(() => {});
        await FeatureFlagService.set(tenantId, 'kb',          true,  {}).catch(() => {});
        await FeatureFlagService.set(tenantId, 'communities', true,  {}).catch(() => {});

        send(7, 94, 'Generando archivos de configuración del cliente...');
        try {
            const { generateTenantFiles } = require('../../../../utils/tenantConfig');
            // Leer features del query param (enviadas desde el modal de creación)
            let features = { jira: false, printQueue: false, microsoftTools: false, azureAD: false, localTickets: true };
            try {
                if (req.query.features) features = { ...features, ...JSON.parse(req.query.features) };
            } catch (_) {}
            generateTenantFiles({
                id:     tenantId,
                slug:   tenant.slug,
                name:   tenant.name,
                domain: tenant.domain || '',
                features,
                branding: { bannerImage: 'banner-promo.jpg', bannerLink: null, primaryColor: '#2563eb' },
                portal:   { sharepoint: { enabled: false, url: null } },
            });
        } catch (cfgErr) {
            // No fatal — archivos pueden regenerarse desde el botón "Config" del portal
            console.warn('[provision] Config files:', cfgErr.message);
        }

        send(8, 100, `¡${tenant.name} configurado exitosamente!`, true);
        res.end();
    } catch (e) {
        res.write(`data: ${JSON.stringify({ error: true, msg: e.message, done: true })}\n\n`);
        res.end();
    }
});

// PATCH /api/admin/tenants/:tenantId/status  { action: 'suspend'|'reactivate', reason? }
router.patch('/:tenantId/status', lifecycle.setStatus);

// PATCH /api/admin/tenants/:tenantId/plan    { plan, password }
router.patch('/:tenantId/plan', async (req, res, next) => {
  try {
    const { password, plan } = req.body;
    if (!password) return res.fail('Se requiere la contraseña del superadministrador', 400);

    const bcrypt                          = require('bcrypt');
    const { executeQuery, equipmentPool } = require('../../../../config/database');

    const [admin] = await executeQuery(equipmentPool,
      'SELECT password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.user.id]);
    if (!admin) return res.fail('Sesión inválida', 401);

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.fail('Contraseña incorrecta', 401);

    lifecycle.changePlan(req, res, next);
  } catch (e) { next(e); }
});

// GET  /api/admin/tenants/:tenantId/export          (JSON completo - GDPR)
router.get('/:tenantId/export', lifecycle.exportData);

// GET  /api/admin/tenants/:tenantId/export/csv/:section  (CSV por sección)
router.get('/:tenantId/export/csv/:section', lifecycle.exportCsv);

// GET  /api/admin/tenants/:tenantId/audit-log?limit=50&offset=0
router.get('/:tenantId/audit-log', lifecycle.auditLog);

// POST /api/admin/tenants/:tenantId/import  { section, rows: [...] }
router.post('/:tenantId/import', lifecycle.importData);

// GET  /api/portal/users/search?q=juan — autocomplete usuarios del tenant del usuario autenticado
// (montado también en tenant routes para búsqueda general)

// GET  /api/admin/tenants/:tenantId/users  — lista usuarios del tenant
router.get('/:tenantId/users', async (req, res, next) => {
  try {
    const sequelize = require('../../../config/database');
    const users = await sequelize.query(
      `SELECT id, email, full_name, username, role, is_active, created_at
       FROM users WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY full_name`,
      { replacements: [req.params.tenantId], type: 'SELECT' }
    );
    res.ok(users);
  } catch (e) { next(e); }
});

// POST /api/admin/tenants/:tenantId/users  — crea usuario para el tenant
router.post('/:tenantId/users', async (req, res, next) => {
  try {
    const sequelize    = require('../../../config/database');
    const bcrypt       = require('bcrypt');
    const { v4: uuidv4 } = require('uuid');
    const { email, full_name, username, role, password } = req.body;

    if (!email) return res.fail('El email es requerido', 400);
    const cleanEmail = email.trim().toLowerCase();

    const [existing] = await sequelize.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      { replacements: [cleanEmail], type: 'SELECT' }
    );
    if (existing) return res.fail('El email ya está registrado en el sistema', 409);

    const VALID_ROLES  = ['administrador','agente','tecnico','especialista','usuario'];
    const rawUsername  = (username || cleanEmail.split('@')[0]).trim().replace(/[^a-zA-Z0-9._-]/g,'').substring(0,100) || `user_${Date.now()}`;
    const fullName     = (full_name || rawUsername).trim().substring(0,150);
    const userRole     = VALID_ROLES.includes(role) ? role : 'usuario';
    const rawPass      = (password || '').trim() || `${rawUsername}@${new Date().getFullYear()}`;
    const hash         = await bcrypt.hash(rawPass, 10);

    await sequelize.query(
      `INSERT INTO users (id, username, full_name, email, password_hash, role, tenant_id, is_active, is_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
      { replacements: [uuidv4(), rawUsername, fullName, cleanEmail, hash, userRole, req.params.tenantId] }
    );

    res.ok(
      { email: cleanEmail, username: rawUsername, role: userRole, tempPassword: password ? null : rawPass },
      'Usuario creado exitosamente',
      201
    );
  } catch (e) { next(e); }
});

// PATCH /api/admin/tenants/:tenantId/users/:userId  — activa/desactiva usuario
router.patch('/:tenantId/users/:userId', async (req, res, next) => {
  try {
    const sequelize = require('../../../config/database');
    const { is_active } = req.body;
    await sequelize.query(
      'UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      { replacements: [is_active ? 1 : 0, req.params.userId, req.params.tenantId] }
    );
    res.ok(null, is_active ? 'Usuario activado' : 'Usuario desactivado');
  } catch (e) { next(e); }
});

// ── Integration Status (config efectiva = tenant || .env) ─────────────────────

// GET /api/admin/tenants/:tenantId/integrations
// Devuelve estado completo: enabled, source, effectiveUri, modules, config (masked)
router.get('/:tenantId/integrations', async (req, res, next) => {
  try {
    const status = await IntegrationConfigService.getStatus(parseInt(req.params.tenantId));
    res.ok(status);
  } catch (e) { next(e); }
});

// ── Feature Flags ─────────────────────────────────────────────────────────────

// GET /api/admin/tenants/:tenantId/features
router.get('/:tenantId/features', async (req, res, next) => {
  try {
    const map = await FeatureFlagService.getAll(req.params.tenantId);
    res.ok(map);
  } catch (e) { next(e); }
});

// PUT /api/admin/tenants/:tenantId/features/:name
router.put('/:tenantId/features/:name', async (req, res, next) => {
  try {
    const { enabled, config } = req.body;
    const tenantId    = parseInt(req.params.tenantId);
    const featureName = req.params.name;

    // Cargar config existente para hacer merge (no sobreescribir campos sensibles)
    const existing      = await FeatureFlagService.getAll(tenantId);
    const currentConfig = existing[featureName]?.config || {};
    const merged        = { ...currentConfig };

    const PLACEHOLDER = '••••••• (guardado)';
    for (const [key, value] of Object.entries(config || {})) {
      if (value === PLACEHOLDER) continue;           // No reemplazar con placeholder
      if (value === '' || value == null) continue;   // No borrar con vacío
      merged[key] = value;
    }

    const record = await FeatureFlagService.set(tenantId, featureName, Boolean(enabled), merged);
    res.ok(record);
  } catch (e) { next(e); }
});

// DELETE /api/admin/tenants/:tenantId/features/:name
router.delete('/:tenantId/features/:name', async (req, res, next) => {
  try {
    await FeatureFlagService.remove(parseInt(req.params.tenantId), req.params.name);
    res.ok(null, 'Feature eliminado');
  } catch (e) { next(e); }
});

// ── Custom Fields ─────────────────────────────────────────────────────────────

// GET /api/admin/tenants/:tenantId/custom-fields?entity_type=ticket
router.get('/:tenantId/custom-fields', async (req, res, next) => {
  try {
    const where = { tenantId: parseInt(req.params.tenantId), isActive: true };
    if (req.query.entity_type) where.entityType = req.query.entity_type;
    const fields = await TenantCustomField.findAll({ where, order: [['sortOrder', 'ASC']] });
    res.ok(fields);
  } catch (e) { next(e); }
});

// POST /api/admin/tenants/:tenantId/custom-fields
router.post('/:tenantId/custom-fields', async (req, res, next) => {
  try {
    const { entityType, fieldKey, fieldLabel, fieldType, fieldOptions, required, sortOrder } = req.body;
    const field = await TenantCustomField.create({
      tenantId:     parseInt(req.params.tenantId),
      entityType, fieldKey, fieldLabel,
      fieldType:    fieldType    || 'text',
      fieldOptions: fieldOptions || null,
      required:     Boolean(required),
      sortOrder:    sortOrder    || 0,
    });
    res.ok(field, 'Campo creado', 201);
  } catch (e) { next(e); }
});

// PATCH /api/admin/tenants/:tenantId/custom-fields/:fieldId
router.patch('/:tenantId/custom-fields/:fieldId', async (req, res, next) => {
  try {
    const field = await TenantCustomField.findOne({
      where: { id: req.params.fieldId, tenantId: parseInt(req.params.tenantId) },
    });
    if (!field) return res.fail('Campo no encontrado', 404);
    const allowed = ['fieldLabel','fieldType','fieldOptions','required','sortOrder','isActive'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    await field.update(updates);
    res.ok(field);
  } catch (e) { next(e); }
});

// DELETE /api/admin/tenants/:tenantId/custom-fields/:fieldId
router.delete('/:tenantId/custom-fields/:fieldId', async (req, res, next) => {
  try {
    const field = await TenantCustomField.findOne({
      where: { id: req.params.fieldId, tenantId: parseInt(req.params.tenantId) },
    });
    if (!field) return res.fail('Campo no encontrado', 404);
    await field.update({ isActive: false });
    res.ok(null, 'Campo desactivado');
  } catch (e) { next(e); }
});

// ── Branding / View Override ──────────────────────────────────────────────────

// GET /api/admin/tenants/:tenantId/branding
router.get('/:tenantId/branding', async (req, res, next) => {
  try {
    const data = await ViewResolver.getOverride(parseInt(req.params.tenantId));
    res.ok(data);
  } catch (e) { next(e); }
});

// PUT /api/admin/tenants/:tenantId/branding
router.put('/:tenantId/branding', async (req, res, next) => {
  try {
    const { companyName, logoUrl, faviconUrl, primaryColor, secondaryColor, customCss } = req.body;
    const record = await ViewResolver.set(parseInt(req.params.tenantId), {
      companyName, logoUrl, faviconUrl, primaryColor, secondaryColor, customCss,
    });
    res.ok(record);
  } catch (e) { next(e); }
});

// POST /api/admin/tenants/:tenantId/regenerate-config
// Regenera los archivos config.js e integrations.js del tenant desde los datos en BD.
router.post('/:tenantId/regenerate-config', async (req, res, next) => {
    try {
        const { executeQuery, equipmentPool } = require('../../../../config/database');
        const { generateTenantFiles }         = require('../../../../utils/tenantConfig');

        const tenantId = parseInt(req.params.tenantId);
        const [tenant] = await executeQuery(equipmentPool,
            'SELECT id, slug, name, domain FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
        if (!tenant) return res.fail('Cliente no encontrado', 404);

        // Features actuales desde feature flags (para preservar lo que el admin ya configuró)
        let jiraEnabled = false;
        try {
            jiraEnabled = await FeatureFlagService.isEnabled(tenantId, 'jira');
        } catch (_) {}

        const dir = generateTenantFiles({
            id:     tenant.id,
            slug:   tenant.slug,
            name:   tenant.name,
            domain: tenant.domain || '',
            features: {
                jira: jiraEnabled, printQueue: false,
                microsoftTools: false, azureAD: false, localTickets: true,
            },
            branding: { bannerImage: 'banner-promo.jpg', bannerLink: null, primaryColor: '#2563eb' },
            portal:   { sharepoint: { enabled: false, url: null } },
        });

        res.ok({ dir, slug: tenant.slug }, `Archivos generados para "${tenant.name}"`);
    } catch (e) { next(e); }
});

// ── GET /:tenantId/enter — superadmin entra al portal de un tenant ───────────
// Genera un JWT de preview (15min) y redirige a /autogestion o /administracion
router.get('/:tenantId/enter', (req, res) => {
  const jwt      = require('jsonwebtoken');
  const tenantId = parseInt(req.params.tenantId);
  const target   = req.query.target === 'administracion' ? '/administracion' : '/autogestion';

  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadmin puede usar esta función' });
  }

  const previewToken = jwt.sign(
    {
      id:        req.user.id,
      email:     req.user.email || req.user.username,
      username:  req.user.username,
      full_name: req.user.full_name || req.user.nombre || 'SuperAdmin',
      role:      req.user.role,
      tenant_id: tenantId,
      _preview:  true,
    },
    process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only',
    { expiresIn: '15m' }
  );

  res.redirect(302, `${target}?_pt=${encodeURIComponent(previewToken)}`);
});

// ── Banner upload ──────────────────────────────────────────────────────────────
// POST /api/admin/tenants/:tenantId/banner
const multer = require('multer');
const fs     = require('fs');
const pathMod = require('path');

const _bannerStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dest = pathMod.join(__dirname, '../../../../public/images');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename(req, file, cb) {
    const ext = pathMod.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `banner-tenant-${req.params.tenantId}${ext}`);
  },
});
const _bannerUpload = multer({
  storage: _bannerStorage,
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo imágenes'));
    cb(null, true);
  },
});

router.post('/:tenantId/banner', _bannerUpload.single('banner'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió imagen' });

    const tenantId   = parseInt(req.params.tenantId);
    const tenantRepo = require('../../../repositories/platform/TenantRepository');
    const tenant     = await tenantRepo.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant no encontrado' });

    const settings = { ...(tenant.settings || {}), bannerImage: req.file.filename };
    await tenantRepo.updateSettings(tenantId, settings);

    res.json({ success: true, bannerImage: req.file.filename });
  } catch (e) { next(e); }
});

module.exports = router;

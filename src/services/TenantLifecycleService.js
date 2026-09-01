'use strict';

const sequelize          = require('../config/database');
const { Tenant }         = require('../models');
const { NotFoundError, ValidationError } = require('../utils/errors');
const FeatureFlagService = require('./FeatureFlagService');
const ViewResolver       = require('./ViewResolver');
const logger             = require('../utils/logger');

const EXPORTABLE_TABLES = [
  'tickets', 'ticket_comments', 'ticket_attachments',
  'service_requests', 'changes', 'problems',
  'config_items', 'kb_articles',
  'sla_policies', 'tenant_features', 'users',
  'approval_flows', 'audit_logs',
];

class TenantLifecycleService {

  // ── Suspender ────────────────────────────────────────────────────────────

  async suspend(tenantId, actorId, reason = '') {
    const tenant = await this._findOrFail(tenantId);
    if (!tenant.is_active) throw new ValidationError('El tenant ya está suspendido');

    await sequelize.query(
      'UPDATE tenants SET is_active = 0, suspended_at = NOW(), updated_at = NOW() WHERE id = ?',
      { replacements: [tenantId] }
    );

    await this._audit(tenantId, 'tenant.suspended', actorId, { reason });
    await FeatureFlagService.invalidate(tenantId);
    await ViewResolver.invalidate(tenantId);

    logger.warn('Tenant suspendido', { tenantId, slug: tenant.slug, actorId, reason });
    return this._findOrFail(tenantId);
  }

  // ── Reactivar ────────────────────────────────────────────────────────────

  async reactivate(tenantId, actorId) {
    const tenant = await this._findOrFail(tenantId);
    if (tenant.is_active) throw new ValidationError('El tenant ya está activo');

    await sequelize.query(
      'UPDATE tenants SET is_active = 1, suspended_at = NULL, updated_at = NOW() WHERE id = ?',
      { replacements: [tenantId] }
    );

    await this._audit(tenantId, 'tenant.reactivated', actorId, {});
    logger.info('Tenant reactivado', { tenantId, slug: tenant.slug, actorId });
    return this._findOrFail(tenantId);
  }

  // ── Cambiar plan ─────────────────────────────────────────────────────────

  async changePlan(tenantId, newPlan, actorId) {
    const VALID_PLANS = ['trial', 'starter', 'professional', 'enterprise'];
    if (!VALID_PLANS.includes(newPlan)) throw new ValidationError(`Plan inválido: ${newPlan}`);

    const tenant = await this._findOrFail(tenantId);
    const oldPlan = tenant.plan;

    await sequelize.query(
      'UPDATE tenants SET plan = ?, updated_at = NOW() WHERE id = ?',
      { replacements: [newPlan, tenantId] }
    );

    await this._audit(tenantId, 'tenant.plan_changed', actorId, { from: oldPlan, to: newPlan });
    await FeatureFlagService.invalidate(tenantId);

    logger.info('Plan de tenant cambiado', { tenantId, slug: tenant.slug, oldPlan, newPlan, actorId });
    return this._findOrFail(tenantId);
  }

  // ── Exportar datos (GDPR) ────────────────────────────────────────────────

  async exportData(tenantId) {
    const tenant = await this._findOrFail(tenantId);
    const export_ = {
      exported_at: new Date().toISOString(),
      tenant:      { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan },
      tables:      {},
    };

    for (const table of EXPORTABLE_TABLES) {
      try {
        const rows = await sequelize.query(
          `SELECT * FROM ${table} WHERE tenant_id = ?`,
          { replacements: [tenantId], type: 'SELECT' }
        );
        export_.tables[table] = rows;
      } catch {
        // tabla sin tenant_id o no existe — omitir silenciosamente
      }
    }

    await this._audit(tenantId, 'tenant.data_exported', null, { tables: Object.keys(export_.tables) });
    return export_;
  }

  // ── Historial de auditoría del tenant ────────────────────────────────────

  async getAuditLog(tenantId, { limit = 50, offset = 0 } = {}) {
    await this._findOrFail(tenantId);
    return sequelize.query(
      'SELECT * FROM tenant_audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      { replacements: [tenantId, limit, offset], type: 'SELECT' }
    );
  }

  // ── Crear nuevo tenant ───────────────────────────────────────────────────

  async create({ name, slug, plan = 'trial', domain = null, contactEmail = null, settings = {} }, actorId) {
    const { executeQuery, equipmentPool } = require('../../config/database');
    const { QueryTypes } = require('sequelize');

    if (!name?.trim()) throw new ValidationError('El nombre del cliente es requerido');

    const cleanSlug = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);

    const slugRows = await executeQuery(equipmentPool,
      'SELECT id FROM tenants WHERE slug = ?', [cleanSlug]
    );
    if (slugRows && slugRows.length > 0) throw new ValidationError(`El slug "${cleanSlug}" ya está en uso`);

    const VALID_PLANS = ['trial', 'starter', 'professional', 'enterprise'];
    if (!VALID_PLANS.includes(plan)) plan = 'trial';

    const cleanDomain       = domain ? domain.toLowerCase().trim() : null;
    const contactEmailClean = contactEmail ? contactEmail.trim().toLowerCase() : null;

    const mergedSettings = JSON.stringify({
      ...(settings || {}),
      ...(cleanDomain       ? { domain: cleanDomain }             : {}),
      ...(contactEmailClean ? { contactEmail: contactEmailClean } : {}),
    });

    // Usar sequelize.query con type INSERT para obtener insertId confiable
    const [tenantId] = await sequelize.query(
      `INSERT INTO tenants (slug, name, plan, settings, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
      { replacements: [cleanSlug, name.trim(), plan, mergedSettings], type: QueryTypes.INSERT }
    );

    // Feature flags base
    await executeQuery(equipmentPool,
      `INSERT IGNORE INTO tenant_features (tenant_id, name, enabled)
       VALUES (?, 'jira', 0), (?, 'portal', 1), (?, 'kb', 1), (?, 'communities', 1)`,
      [tenantId, tenantId, tenantId, tenantId]
    ).catch(() => {});

    await this._audit(tenantId, 'tenant.created', actorId, { name: name.trim(), slug: cleanSlug, plan, domain: cleanDomain });
    logger.info('Nuevo tenant creado', { tenantId, slug: cleanSlug, name: name.trim(), actorId });
    return this._findOrFail(tenantId);
  }

  // ── Listar todos con stats (para el panel super admin) ────────────────────

  async listWithStats() {
    const { executeQuery, equipmentPool } = require('../../config/database');
    return executeQuery(equipmentPool,
      `SELECT t.id, t.slug, t.name, t.plan, t.is_active, t.created_at,
              NULL AS suspended_at,
              IFNULL(JSON_UNQUOTE(JSON_EXTRACT(t.settings, '$.domain')), '') AS domain,
              IFNULL(JSON_UNQUOTE(JSON_EXTRACT(t.settings, '$.contactEmail')), '') AS contact_email,
              COUNT(DISTINCT CASE WHEN u.is_active = 1 AND u.deleted_at IS NULL THEN u.id END) AS user_count,
              COUNT(DISTINCT tk.id)                                                             AS ticket_count,
              CASE WHEN t.slug = 'default'
                THEN (SELECT COUNT(*) FROM employees WHERE is_active = 1 AND deleted_at IS NULL)
                ELSE (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND is_active = 1 AND deleted_at IS NULL)
              END AS employee_count,
              CASE WHEN t.slug = 'default'
                THEN (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL)
                ELSE (SELECT COUNT(*) FROM config_items WHERE tenant_id = t.id AND deleted_at IS NULL)
              END AS equipment_count,
              IFNULL((SELECT enabled FROM tenant_features WHERE tenant_id = t.id AND name = 'jira' LIMIT 1), 0) AS jira_enabled
       FROM tenants t
       LEFT JOIN users u  ON u.tenant_id = t.id
       LEFT JOIN jira_tickets tk ON tk.tenant_id = t.id
       GROUP BY t.id
       ORDER BY t.name ASC`,
      []
    );
  }

  // ── Exportar sección como CSV ────────────────────────────────────────────

  async exportSectionCsv(tenantId, section) {
    await this._findOrFail(tenantId);

    const QUERIES = {
      users: {
        sql:  'SELECT email, full_name, username, role, employee_cip, is_active, created_at FROM users WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY full_name',
        file: 'usuarios',
      },
      config_items: {
        sql:  `SELECT ci.name, COALESCE(ct.name, ci.ci_type_id) AS ci_type_id,
               ci.status, ci.environment, ci.location, ci.serial_number, ci.ip_address
               FROM config_items ci
               LEFT JOIN ci_types ct ON ct.id = ci.ci_type_id
               WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL ORDER BY ci.name`,
        file: 'equipos',
      },
      tickets: {
        sql:  'SELECT titulo, descripcion, tipo, status, priority, sla_status, created_at, resolved_at FROM tickets WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
        file: 'incidencias',
      },
      kb_articles: {
        sql:  'SELECT title, excerpt, tags, status, views, helpful_yes, helpful_no, created_at FROM kb_articles WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY title',
        file: 'kb_articulos',
      },
    };

    const def = QUERIES[section];
    if (!def) throw new Error(`Sección desconocida: ${section}. Opciones: ${Object.keys(QUERIES).join(', ')}`);

    const rows = await sequelize.query(def.sql, { replacements: [tenantId], type: 'SELECT' });

    if (!rows.length) {
      const tenant = await this._findOrFail(tenantId);
      return { csv: '', filename: `${tenant.slug}_${def.file}_vacio.csv` };
    }

    const headers = Object.keys(rows[0]);
    const escape  = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
    };

    const lines = [
      'sep=,',
      headers.join(','),
      ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ];

    const tenant = await this._findOrFail(tenantId);
    const date   = new Date().toISOString().slice(0,10);
    return {
      csv:      lines.join('\r\n'),
      filename: `${tenant.slug}_${def.file}_${date}.csv`,
    };
  }

  // ── Listar todos los tenants (admin plataforma) ──────────────────────────

  async list({ includeInactive = false } = {}) {
    const { executeQuery, equipmentPool } = require('../../config/database');
    const where = includeInactive ? '' : 'WHERE is_active = 1';
    return executeQuery(equipmentPool,
      `SELECT id, slug, name, plan, is_active, NULL AS suspended_at, created_at FROM tenants ${where} ORDER BY name ASC`,
      []
    );
  }

  // ── Privados ─────────────────────────────────────────────────────────────

  async _findOrFail(tenantId) {
    const [tenant] = await sequelize.query(
      'SELECT * FROM tenants WHERE id = ?',
      { replacements: [tenantId], type: 'SELECT' }
    );
    if (!tenant) throw new NotFoundError(`Tenant ${tenantId} no encontrado`);
    return tenant;
  }

  async _audit(tenantId, event, actorId, metadata) {
    try {
      await sequelize.query(
        'INSERT INTO tenant_audit_log (tenant_id, event, actor_id, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
        { replacements: [tenantId, event, actorId || null, JSON.stringify(metadata)] }
      );
    } catch (e) {
      logger.error('TenantLifecycleService: error en audit', { error: e.message });
    }
  }
}

module.exports = new TenantLifecycleService();

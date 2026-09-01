
const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');

// ── Top Incidentes: cache local stale-while-revalidate ───────────────────
let _topIncCache   = null;
let _topIncPromise = null; // promise-lock: waiters await the same promise

function _refreshTopInc() {
    if (_topIncPromise) return _topIncPromise; // ya hay un refresh en curso: devuelve la misma promise
    _topIncPromise = (async () => {
        try {
            const rows = await dbQuery(`
                SELECT
                    jt.reporter                                          AS email,
                    COUNT(*)                                             AS inc_30d,
                    COALESCE(e.full_name, '')                           AS full_name,
                    COALESCE(aav.equipment_code, jt.device_code, '')    AS device_code,
                    COALESCE(eq.brand,  '')                             AS brand,
                    COALESCE(eq.model,  '')                             AS model,
                    COALESCE(eq.equipment_type, '')                     AS equipment_type,
                    COALESCE(eq.status, '')                             AS eq_status
                FROM jira_tickets jt
                LEFT JOIN employees               e   ON e.email COLLATE utf8mb4_general_ci = jt.reporter
                LEFT JOIN active_assignments_view aav ON aav.employee_id      = e.id
                          AND aav.equipment_code IS NOT NULL AND aav.equipment_code != ''
                LEFT JOIN equipment               eq  ON eq.device_code COLLATE utf8mb4_general_ci =
                          COALESCE(NULLIF(aav.equipment_code COLLATE utf8mb4_general_ci,''), NULLIF(jt.device_code,''))
                WHERE jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                  AND jt.reporter   IS NOT NULL AND jt.reporter != ''
                GROUP BY jt.reporter, e.full_name,
                         aav.equipment_code, jt.device_code,
                         eq.brand, eq.model, eq.equipment_type, eq.status
                ORDER BY inc_30d DESC
                LIMIT 8
            `);
            _topIncCache = { data: rows, ts: Date.now() };
        } catch(e) {
            console.error('[top-inc]', e.message);
            if (!_topIncCache) _topIncCache = { data: [], ts: Date.now() }; // evita loop eterno
        } finally {
            _topIncPromise = null;
        }
    })();
    return _topIncPromise;
}

// Índice (ignora si ya existe) + primera carga — solo si la tabla existe
setTimeout(function() {
    dbQuery(`SHOW TABLES LIKE 'jira_tickets'`).then(r => {
        if (!r.length) return;
        dbQuery(`ALTER TABLE jira_tickets ADD INDEX idx_ti_reporter_date (reporter(100), created_at)`).catch(() => {});
        _refreshTopInc();
    }).catch(() => {});
}, 500);
setInterval(function() { if (!_topIncPromise) _refreshTopInc(); }, 10 * 60 * 1000);


router.get('/employee-info', authenticateToken, async (req, res) => {
    const { email } = req.query;
    if (!email) return res.json({ success: false, data: null });
    try {
        const tenantId  = req.user?.tenant_id;
        const isPrimary = !tenantId || parseInt(tenantId) === 1;

        if (!isPrimary) {
            // Tenants externos: buscar en users + user_equipment
            const { executeQuery, equipmentPool } = require('../../config/database');
            const uRows = await executeQuery(equipmentPool,
                `SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER(?) AND tenant_id = ? AND is_active = 1 LIMIT 1`,
                [email, parseInt(tenantId)]
            );
            if (!uRows.length) return res.json({ success: true, data: { full_name:'', department:'', equipo:'', modelo:'', ubicacion:'' } });
            const u = uRows[0];
            const eqRows = await executeQuery(equipmentPool,
                `SELECT device_code, serial_number, equipment_type, brand, model, department_name, location_name, status
                 FROM user_equipment
                 WHERE user_id = ? AND status = 'Activo' AND return_date IS NULL
                 ORDER BY id DESC LIMIT 1`,
                [u.id]
            );
            const eq = eqRows[0] || {};
            return res.json({
                success: true,
                data: {
                    full_name:  u.full_name         || '',
                    department: eq.department_name  || '',
                    equipo:     eq.device_code      || '',
                    modelo:     [eq.brand, eq.model].filter(Boolean).join(' ') || '',
                    ubicacion:  eq.location_name    || '',
                    serial:     eq.serial_number    || '',
                    tipo:       eq.equipment_type   || '',
                    eq_status:  eq.status           || '',
                }
            });
        }

        // Tenant primario (Integratel): flujo original
        const empRows = await dbQuery(
            `SELECT id, full_name, cip FROM employees WHERE email = ? LIMIT 1`,
            [email]
        );
        if (!empRows.length) return res.json({ success: true, data: { full_name:'', department:'', equipo:'', modelo:'', ubicacion:'' } });

        const emp = empRows[0];
        const asgRows = await dbQuery(
            `SELECT employee_name, equipment_code, equipment_model, brand,
                    department_name, location_name
             FROM active_assignments_view
             WHERE employee_id = ?
             ORDER BY assignment_id DESC
             LIMIT 1`,
            [emp.id]
        );
        const a = asgRows[0] || {};

        let eqExtra = {};
        if (a.equipment_code) {
            try {
                const eqRows = await dbQuery(
                    `SELECT serial_number, equipment_type, brand, model, status FROM equipment WHERE device_code = ? LIMIT 1`,
                    [a.equipment_code]
                );
                if (eqRows.length) eqExtra = eqRows[0];
            } catch(_) {}
        }

        res.json({
            success: true,
            data: {
                full_name:  emp.full_name      || '',
                department: a.department_name  || '',
                equipo:     a.equipment_code   || '',
                modelo:     a.equipment_model  || eqExtra.model || [a.brand].filter(Boolean).join(' ') || '',
                ubicacion:  a.location_name    || '',
                serial:     eqExtra.serial_number  || '',
                tipo:       eqExtra.equipment_type || '',
                eq_status:  eqExtra.status         || '',
            }
        });
    } catch (e) {
        console.error('employee-info error:', e.message);
        res.json({ success: false, data: null });
    }
});

// ── CMDB: historial por equipo (device_code) ──────────────────────────
router.get('/cmdb/device/:code', authenticateToken, async (req, res) => {
    const code = req.params.code;
    try {
        const eqRows = await dbQuery(
            `SELECT device_code, serial_number, equipment_type, brand, model,
                    operating_system, ram_memory, disk_capacity, status
             FROM equipment WHERE device_code = ? LIMIT 1`,
            [code]
        );
        const device = eqRows[0] || { device_code: code };

        // 1. Tickets con device_code directo
        const byCode = await dbQuery(
            `SELECT ticket_key, summary, priority, status, internal_status,
                    assigned_to_name, created_at, resolved_at, reporter
             FROM jira_tickets WHERE device_code = ? ORDER BY created_at DESC LIMIT 50`,
            [code]
        );

        // 2. Buscar reportes de empleados actualmente asignados a este equipo
        let byReporter = [];
        try {
            const emailRows = await dbQuery(
                `SELECT DISTINCT e.email FROM employees e
                 WHERE e.id IN (SELECT employee_id FROM active_assignments_view WHERE equipment_code = ?)`,
                [code]
            );
            if (emailRows.length) {
                const emails = emailRows.map(r => r.email);
                const ph = emails.map(() => '?').join(',');
                const existingKeys = new Set(byCode.map(t => t.ticket_key));
                const extra = await dbQuery(
                    `SELECT ticket_key, summary, priority, status, internal_status,
                            assigned_to_name, created_at, resolved_at, reporter
                     FROM jira_tickets WHERE reporter IN (${ph}) ORDER BY created_at DESC LIMIT 50`,
                    emails
                );
                byReporter = extra.filter(t => !existingKeys.has(t.ticket_key));
            }
        } catch(_) {}

        const tickets = [...byCode, ...byReporter]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50);

        const now = Date.now();
        const last30 = tickets.filter(t => now - new Date(t.created_at).getTime() < 30*864e5).length;
        const last60 = tickets.filter(t => now - new Date(t.created_at).getTime() < 60*864e5).length;
        const last90 = tickets.filter(t => now - new Date(t.created_at).getTime() < 90*864e5).length;
        const risk = last30 >= 6 ? 'critico' : last30 >= 4 ? 'alto' : last30 >= 2 ? 'medio' : 'bajo';
        const recommendation = last60 >= 8 ? 'reemplazo_urgente' : last30 >= 4 ? 'considerar_reemplazo' : null;

        res.json({ success: true, device, history: { total: tickets.length, last30, last60, last90, risk, recommendation, tickets } });
    } catch(e) {
        res.json({ success: false, error: e.message, device: { device_code: code }, history: { total:0, last30:0, last60:0, last90:0, risk:'bajo', recommendation:null, tickets:[] } });
    }
});

// ── CMDB: historial por reporter (email) — más confiable para usuarios ─
router.get('/cmdb/by-reporter', authenticateToken, async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false });
    try {
        // Equipo asignado actualmente
        const empRows = await dbQuery(`SELECT id, full_name FROM employees WHERE email COLLATE utf8mb4_general_ci = ? LIMIT 1`, [email]);
        const emp = empRows[0];
        let device = { device_code: null };

        if (emp) {
            const asgRows = await dbQuery(
                `SELECT equipment_code, equipment_model, brand FROM active_assignments_view WHERE employee_id = ? AND equipment_code IS NOT NULL AND equipment_code != '' ORDER BY assignment_id DESC LIMIT 1`,
                [emp.id]
            );
            const dc = asgRows[0]?.equipment_code;
            if (dc) {
                const eqRows = await dbQuery(
                    `SELECT device_code, serial_number, equipment_type, brand, model,
                            operating_system, ram_memory, disk_capacity, status
                     FROM equipment WHERE device_code = ? LIMIT 1`,
                    [dc]
                );
                device = eqRows[0] || { device_code: dc, model: asgRows[0].equipment_model, brand: asgRows[0].brand };
            }
        }

        // Todos los tickets del reporter (sin filtrar por device_code)
        const tickets = await dbQuery(
            `SELECT ticket_key, summary, priority, status, internal_status,
                    assigned_to_name, created_at, resolved_at, reporter, device_code
             FROM jira_tickets WHERE reporter = ? ORDER BY created_at DESC LIMIT 50`,
            [email]
        );

        const now = Date.now();
        const last30 = tickets.filter(t => now - new Date(t.created_at).getTime() < 30*864e5).length;
        const last60 = tickets.filter(t => now - new Date(t.created_at).getTime() < 60*864e5).length;
        const last90 = tickets.filter(t => now - new Date(t.created_at).getTime() < 90*864e5).length;
        const risk = last30 >= 6 ? 'critico' : last30 >= 4 ? 'alto' : last30 >= 2 ? 'medio' : 'bajo';
        const recommendation = last60 >= 8 ? 'reemplazo_urgente' : last30 >= 4 ? 'considerar_reemplazo' : null;

        res.json({ success: true, device, reporter: email, full_name: emp?.full_name || '',
            history: { total: tickets.length, last30, last60, last90, risk, recommendation, tickets } });
    } catch(e) {
        res.json({ success: false, error: e.message, device: { device_code: null },
            history: { total:0, last30:0, last60:0, last90:0, risk:'bajo', recommendation:null, tickets:[] } });
    }
});

// CMDB: top equipos con más incidencias
router.get('/cmdb/hot-devices', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT jt.device_code,
                   COUNT(*) AS total,
                   SUM(CASE WHEN jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS last30,
                   SUM(CASE WHEN jt.created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) THEN 1 ELSE 0 END) AS last60,
                   e.brand, e.model, e.equipment_type, e.status AS eq_status, e.serial_number
            FROM jira_tickets jt
            LEFT JOIN equipment e ON e.device_code = jt.device_code
            WHERE jt.device_code IS NOT NULL AND jt.device_code != ''
            GROUP BY jt.device_code, e.brand, e.model, e.equipment_type, e.status, e.serial_number
            ORDER BY last30 DESC, total DESC
            LIMIT 30
        `);
        const at_risk = rows.filter(r => Number(r.last30) >= 4).length;
        const suggest_replace = rows.filter(r => Number(r.last60) >= 8).length;
        res.json({ success: true, devices: rows, stats: { total_with_incidents: rows.length, at_risk, suggest_replace } });
    } catch(e) {
        res.json({ success: false, devices: [], stats: { total_with_incidents:0, at_risk:0, suggest_replace:0 } });
    }
});


// Top incidentes: sirve desde cache (instantáneo), refresca en background si stale
router.get('/cmdb/top-incidentes', authenticateToken, async (req, res) => {
    const MAX_AGE = 10 * 60 * 1000;
    if (!_topIncCache) {
        await _refreshTopInc(); // awaita la promise en curso O inicia una nueva
    } else if (Date.now() - _topIncCache.ts > MAX_AGE) {
        _refreshTopInc(); // stale-while-revalidate: responde YA, refresca en BG
    }
    if (!_topIncCache || !Array.isArray(_topIncCache.data)) {
        return res.json({ success: true, loading: false, data: [] });
    }
    res.json({ success: true, loading: false, data: _topIncCache.data, ts: _topIncCache.ts });
});

// CMDB quick-stats: 3 COUNTs locales, sin joins pesados (~30ms)
router.get('/cmdb/quick-stats', authenticateToken, async (req, res) => {
    try {
        const [[eq], [emp], [asig], [incEq], [incMail]] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS n FROM equipment`),
            dbQuery(`SELECT COUNT(*) AS n FROM employees`),
            dbQuery(`SELECT COUNT(*) AS n FROM active_assignments_view`),
            dbQuery(`SELECT COUNT(DISTINCT jt.id) AS n FROM jira_tickets jt
                     INNER JOIN employees e ON e.email COLLATE utf8mb4_general_ci = jt.reporter
                     INNER JOIN active_assignments_view aav ON aav.employee_id = e.id
                         AND aav.equipment_code IS NOT NULL AND aav.equipment_code != ''
                     WHERE jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`),
            dbQuery(`SELECT COUNT(DISTINCT jt.id) AS n FROM jira_tickets jt
                     INNER JOIN employees e ON e.email COLLATE utf8mb4_general_ci = jt.reporter
                     WHERE jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`),
        ]);
        res.json({ success: true, equipos: eq.n, empleados: emp.n, asignados: asig.n,
                   inc_by_device: incEq.n, inc_by_email: incMail.n });
    } catch(e) {
        res.json({ success: false, equipos: 0, empleados: 0, asignados: 0, inc_by_device: 0, inc_by_email: 0 });
    }
});

// Detalle expandido de stat cards (with_equip | identified)
router.get('/cmdb/stat-detail', authenticateToken, async (req, res) => {
    const { type } = req.query;
    try {
        let rows;
        if (type === 'with_equip') {
            rows = await dbQuery(`
                SELECT
                    aav.equipment_code                  AS device_code,
                    COUNT(DISTINCT jt.id)               AS inc_30d,
                    MAX(e.full_name)                    AS full_name,
                    MAX(eq.brand)                       AS brand,
                    MAX(eq.model)                       AS model,
                    MAX(eq.equipment_type)              AS equipment_type,
                    MAX(eq.status)                      AS eq_status
                FROM jira_tickets jt
                INNER JOIN employees               e   ON e.email COLLATE utf8mb4_general_ci = jt.reporter
                INNER JOIN active_assignments_view aav ON aav.employee_id = e.id
                    AND aav.equipment_code IS NOT NULL AND aav.equipment_code != ''
                LEFT JOIN equipment                eq  ON eq.device_code COLLATE utf8mb4_general_ci = aav.equipment_code
                WHERE jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY aav.equipment_code
                ORDER BY inc_30d DESC
                LIMIT 30
            `);
        } else {
            rows = await dbQuery(`
                SELECT
                    jt.reporter                                         AS email,
                    COUNT(DISTINCT jt.id)                               AS inc_30d,
                    MAX(e.full_name)                                    AS full_name,
                    MAX(aav.equipment_code)                             AS device_code,
                    MAX(eq.brand)                                       AS brand,
                    MAX(eq.model)                                       AS model
                FROM jira_tickets jt
                INNER JOIN employees               e   ON e.email COLLATE utf8mb4_general_ci = jt.reporter
                LEFT JOIN active_assignments_view  aav ON aav.employee_id = e.id
                    AND aav.equipment_code IS NOT NULL AND aav.equipment_code != ''
                LEFT JOIN equipment                eq  ON eq.device_code COLLATE utf8mb4_general_ci = aav.equipment_code
                WHERE jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY jt.reporter, e.full_name
                ORDER BY inc_30d DESC
                LIMIT 30
            `);
        }
        res.json({ success: true, data: rows });
    } catch(e) {
        console.error('[stat-detail]', e.message);
        res.json({ success: false, data: [] });
    }
});

// Autocompletar: código de equipo o correo de reporter
router.get('/cmdb/autocomplete', authenticateToken, async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });
    try {
        const devices = await dbQuery(
            `SELECT device_code, brand, model, equipment_type FROM equipment WHERE device_code LIKE ? LIMIT 8`,
            [`${q}%`]
        );
        const reporters = await dbQuery(
            `SELECT e.email, e.full_name, aav.equipment_code
             FROM employees e
             INNER JOIN active_assignments_view aav ON aav.employee_id = e.id
             WHERE (e.email LIKE ? OR e.full_name LIKE ?) AND aav.equipment_code IS NOT NULL AND aav.equipment_code != ''
             LIMIT 8`,
            [`%${q}%`, `%${q}%`]
        );
        const data = [
            ...devices.map(d => ({ type:'device', value: d.device_code, label: d.device_code, sub: [d.brand, d.model].filter(Boolean).join(' ') || d.equipment_type || '' })),
            ...reporters.map(e => ({ type:'reporter', value: e.equipment_code, label: e.email, sub: `${e.full_name||''} · ${e.equipment_code||''}` }))
        ];
        res.json({ success: true, data });
    } catch(e) {
        res.json({ success: true, data: [] });
    }
});

// Stats de categorías para el panel Categorías (desde BD local, rápido)
router.get('/sincategorizar/stats', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT
                COALESCE(NULLIF(TRIM(component), ''), 'Sin categorizar') AS categoria,
                COUNT(*) AS total
            FROM jira_tickets
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
            GROUP BY COALESCE(NULLIF(TRIM(component), ''), 'Sin categorizar')
            ORDER BY total DESC
            LIMIT 25
        `);
        res.json({ success: true, data: rows });
    } catch(e) {
        res.json({ success: false, data: [] });
    }
});

// ============================================================

router.get('/agents', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/servicedeskapi/servicedesk/${SD_ID}/agent`
        );
        res.json({ success: true, data: data.values || [] });
    } catch (error) {
        const s = error.response?.status || 500;
        res.status(s).json({
            success:  false,
            noAccess: s === 403 || s === 401,
            message:  error.response?.data?.errorMessage || error.message
        });
    }
});


// ============================================================

router.get('/technicians', authenticateToken, async (_req, res) => {
    try {
        const techs = await dbQuery(
            `SELECT id, full_name, username, email, role
             FROM users WHERE is_active = 1 AND deleted_at IS NULL
             ORDER BY full_name`
        );
        res.json({ success: true, data: techs });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ============================================================

router.post('/specialists', authenticateToken, async (req, res) => {
    const { full_name, username, email, phone, password, specialty } = req.body;
    if (!full_name || !email || !password)
        return res.status(400).json({ success: false, message: 'Nombre, email y contraseña son obligatorios' });
    try {
        const bcrypt = require('bcrypt');
        const hash = await bcrypt.hash(password, 10);
        const uname = username || email.split('@')[0];
        const exists = await dbQuery(`SELECT id FROM users WHERE (username=? OR email=?) AND deleted_at IS NULL LIMIT 1`, [uname, email]);
        if (exists.length) return res.status(409).json({ success: false, message: 'El usuario o email ya existe' });
        const cols = await dbQuery(`SHOW COLUMNS FROM users LIKE 'password_hash'`);
        const passCol = cols.length ? 'password_hash' : 'password';
        const deleted = await dbQuery(`SELECT id FROM users WHERE (username=? OR email=?) LIMIT 1`, [uname, email]);
        let result;
        if (deleted.length) {
            await dbQuery(
                `UPDATE users SET full_name=?, username=?, email=?, phone=?, ${passCol}=?, role='especialista', specialty=?, is_active=1, is_verified=1, deleted_at=NULL WHERE id=?`,
                [full_name, uname, email, phone||null, hash, specialty||null, deleted[0].id]
            );
            result = { insertId: deleted[0].id };
        } else {
            result = await dbQuery(
                `INSERT INTO users (username, email, phone, ${passCol}, full_name, role, specialty, is_active, is_verified, created_by)
                 VALUES (?, ?, ?, ?, ?, 'especialista', ?, 1, 1, ?)`,
                [uname, email, phone||null, hash, full_name, specialty||null, req.user?.id||null]
            );
        }
        res.status(201).json({ success: true, data: { id: result.insertId, full_name, email, username: uname } });
    } catch (e) {
        if (e.message.includes('Duplicate')) return res.status(409).json({ success: false, message: 'El email o usuario ya existe' });
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/jira/specialists — Lista de especialistas
router.get('/specialists', authenticateToken, async (_req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.specialty, u.is_active,
                    COUNT(jt.id) AS total_tickets,
                    SUM(jt.internal_status NOT IN ('resuelto','cerrado')) AS open_tickets
             FROM users u
             LEFT JOIN jira_tickets jt ON jt.assigned_to = u.id
             WHERE u.deleted_at IS NULL AND u.role = 'especialista'
             GROUP BY u.id ORDER BY u.full_name`
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// PUT /api/jira/specialists/:id/toggle — Activar/desactivar
router.put('/specialists/:id/toggle', authenticateToken, async (req, res) => {
    try {
        await dbQuery(`UPDATE users SET is_active = NOT is_active WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ============================================================

router.get('/software-catalog', authenticateToken, async (req, res) => {
    const { q } = req.query;
    try {
        const rows = await dbQuery(
            `SELECT id, nombre, version, fabricante FROM software_catalog
             WHERE activo = 1 ${q ? 'AND nombre LIKE ?' : ''}
             ORDER BY nombre ASC LIMIT 15`,
            q ? [`%${q}%`] : []
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/jira/software-catalog — Agregar software nuevo
router.post('/software-catalog', authenticateToken, async (req, res) => {
    const { nombre, version, fabricante } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ success: false, message: 'Nombre requerido' });
    try {
        const exists = await dbQuery(`SELECT id FROM software_catalog WHERE nombre = ? LIMIT 1`, [nombre.trim()]);
        if (exists.length) return res.json({ success: true, data: exists[0], nuevo: false });
        const r = await dbQuery(
            `INSERT INTO software_catalog (nombre, version, fabricante) VALUES (?, ?, ?)`,
            [nombre.trim(), version||null, fabricante||null]
        );
        res.status(201).json({ success: true, data: { id: r.insertId, nombre: nombre.trim() }, nuevo: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ============================================================

const CATEGORIES_DDL = `
    CREATE TABLE IF NOT EXISTS ticket_categories (
        id               INT PRIMARY KEY AUTO_INCREMENT,
        parent_id        INT          DEFAULT NULL,
        name             VARCHAR(255) NOT NULL,
        icon             VARCHAR(50)  DEFAULT 'bi-tag',
        component_id     VARCHAR(120),
        component_label  VARCHAR(100),
        app_id           VARCHAR(120),
        app_label        VARCHAR(100),
        tipologia_id     VARCHAR(120),
        tipologia_label  VARCHAR(100),
        impact_id        VARCHAR(20)  DEFAULT '618437',
        impact_label     VARCHAR(100),
        urgency_id       VARCHAR(20)  DEFAULT '618441',
        urgency_label    VARCHAR(100),
        description_template TEXT,
        sort_order       INT          DEFAULT 0,
        is_active        TINYINT      DEFAULT 1,
        created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cat_parent (parent_id)
    )`;

let _catTableReady = false;
async function ensureCatTable() {
    if (_catTableReady) return;
    await dbQuery(CATEGORIES_DDL);
    // Migración: agregar parent_id si la tabla ya existía sin él
    try {
        await dbQuery(`ALTER TABLE ticket_categories ADD COLUMN parent_id INT DEFAULT NULL AFTER id`);
    } catch(e) { /* ya existe */ }
    try {
        await dbQuery(`ALTER TABLE ticket_categories ADD INDEX idx_cat_parent (parent_id)`);
    } catch(e) { /* ya existe */ }
    try {
        await dbQuery(`ALTER TABLE ticket_categories ADD COLUMN tenant_id INT DEFAULT 1 AFTER is_active`);
    } catch(e) { /* ya existe */ }
    _catTableReady = true;
}

router.get('/categories', optionalAuth, async (req, res) => {
    try {
        await ensureCatTable();
        const tenantId = req.user?.tenant_id || 1;
        const flat = await dbQuery(
            `SELECT * FROM ticket_categories WHERE is_active=1 AND tenant_id=? ORDER BY COALESCE(parent_id,id), sort_order, name`,
            [tenantId]
        );
        // Si se pide árbol, construir jerarquía
        if (req.query.tree === '1') {
            const map = {};
            flat.forEach(c => { map[c.id] = { ...c, children: [] }; });
            const roots = [];
            flat.forEach(c => {
                if (c.parent_id && map[c.parent_id]) map[c.parent_id].children.push(map[c.id]);
                else roots.push(map[c.id]);
            });
            return res.json({ success: true, data: roots });
        }
        res.json({ success: true, data: flat });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/categories', authenticateToken, async (req, res) => {
    try {
        await ensureCatTable();
        const { name, icon, parent_id, component_id, component_label, app_id, app_label,
                tipologia_id, tipologia_label, impact_id, impact_label,
                urgency_id, urgency_label, description_template, sort_order } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Nombre requerido' });
        const tenantId = req.user?.tenant_id || 1;
        const result = await dbQuery(`
            INSERT INTO ticket_categories
                (parent_id,name,icon,component_id,component_label,app_id,app_label,tipologia_id,tipologia_label,
                 impact_id,impact_label,urgency_id,urgency_label,description_template,sort_order,tenant_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [parent_id||null, name, icon||'bi-tag', component_id||null, component_label||null,
            app_id||null, app_label||null, tipologia_id||null, tipologia_label||null,
            impact_id||'618437', impact_label||null,
            urgency_id||'618441', urgency_label||null,
            description_template||null, sort_order||0, tenantId]);
        res.status(201).json({ success: true, data: { id: result.insertId, name, parent_id: parent_id||null } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/categories/:id', authenticateToken, async (req, res) => {
    try {
        const { name, icon, parent_id, component_id, component_label, app_id, app_label,
                tipologia_id, tipologia_label, impact_id, impact_label,
                urgency_id, urgency_label, description_template, sort_order } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Nombre requerido' });
        await dbQuery(`
            UPDATE ticket_categories SET
                parent_id=?,name=?,icon=?,component_id=?,component_label=?,app_id=?,app_label=?,
                tipologia_id=?,tipologia_label=?,impact_id=?,impact_label=?,
                urgency_id=?,urgency_label=?,description_template=?,sort_order=?
            WHERE id=?
        `, [parent_id||null, name, icon||'bi-tag', component_id||null, component_label||null,
            app_id||null, app_label||null, tipologia_id||null, tipologia_label||null,
            impact_id||'618437', impact_label||null,
            urgency_id||'618441', urgency_label||null,
            description_template||null, sort_order||0,
            req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/categories/:id', authenticateToken, async (req, res) => {
    try {
        await dbQuery(`UPDATE ticket_categories SET is_active=0 WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============================================================

router.get('/automations', authenticateToken, async (_req, res) => {
    try {
        const cfg = await getAutomationConfig();
        res.json({ success: true, data: cfg });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/automations', authenticateToken, async (req, res) => {
    try {
        const allowed = ['p1_escalation_enabled','p1_escalation_email','p1_escalation_minutes',
                         'satisfaction_enabled','sla_alert_enabled','sla_alert_email','sla_alert_minutes'];
        for (const [k, v] of Object.entries(req.body)) {
            if (allowed.includes(k)) {
                await dbQuery(`INSERT INTO itsm_automations (\`key\`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [k, String(v)]);
            }
        }
        res.json({ success: true, message: 'Configuración guardada' });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});


// ============================================================

const VALID_ROLES = ['administrador', 'especialista', 'visor', 'usuario'];

router.get('/admin/users', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'administrador') return res.status(403).json({ success: false, message: 'Sin permiso' });
    try {
        const rows = await dbQuery(
            `SELECT u.id, u.full_name, u.username, u.email, u.role, u.is_active, u.last_login
             FROM users u
             INNER JOIN (SELECT MAX(id) AS max_id, email FROM users WHERE deleted_at IS NULL GROUP BY email) t
               ON u.id = t.max_id AND u.email = t.email
             WHERE u.deleted_at IS NULL
             ORDER BY u.full_name ASC`
        );
        res.json({ success: true, data: rows });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/admin/users', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'administrador') return res.status(403).json({ success: false, message: 'Sin permiso' });
    const { full_name, username, email, password, role } = req.body;
    if (!full_name || !username || !email || !password) return res.status(400).json({ success: false, message: 'Nombre, usuario, email y contraseña son requeridos' });
    if (password.length < 8) return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ success: false, message: 'Rol inválido' });
    try {
        const bcrypt = require('bcrypt'); // mismo módulo que usa el modelo Sequelize
        const exists = await dbQuery(`SELECT id FROM users WHERE (username=? OR email=?) AND deleted_at IS NULL LIMIT 1`, [username, email]);
        if (exists.length) return res.status(409).json({ success: false, message: 'El usuario o email ya existe' });
        const hash = await bcrypt.hash(password, 12);
        const cols = await dbQuery(`SHOW COLUMNS FROM users LIKE 'password_hash'`);
        const passCol = cols.length ? 'password_hash' : 'password';
        // Si el usuario fue eliminado antes, reactivarlo en vez de duplicar
        const deleted = await dbQuery(`SELECT id FROM users WHERE (username=? OR email=?) LIMIT 1`, [username, email]);
        let resultId;
        if (deleted.length) {
            await dbQuery(
                `UPDATE users SET full_name=?, username=?, email=?, ${passCol}=?, role=?, is_active=1, is_verified=1, deleted_at=NULL WHERE id=?`,
                [full_name, username, email, hash, role, deleted[0].id]
            );
            resultId = deleted[0].id;
        } else {
            const result = await dbQuery(
                `INSERT INTO users (full_name, username, email, ${passCol}, role, is_active, is_verified, created_at)
                 VALUES (?,?,?,?,?,1,1,NOW())`,
                [full_name, username, email, hash, role]
            );
            resultId = result.insertId;
        }
        res.status(201).json({ success: true, id: resultId });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/admin/users/:id/role', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'administrador') return res.status(403).json({ success: false, message: 'Sin permiso' });
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ success: false, message: 'Rol inválido' });
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ success: false, message: 'No puedes cambiar tu propio rol' });
    try {
        await dbQuery(`UPDATE users SET role=? WHERE id=?`, [role, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/admin/users/:id/status', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'administrador') return res.status(403).json({ success: false, message: 'Sin permiso' });
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ success: false, message: 'No puedes desactivarte a ti mismo' });
    try {
        const rows = await dbQuery(`SELECT is_active FROM users WHERE id=? LIMIT 1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        const newStatus = rows[0].is_active ? 0 : 1;
        await dbQuery(`UPDATE users SET is_active=? WHERE id=?`, [newStatus, req.params.id]);
        res.json({ success: true, is_active: newStatus });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/admin/users/:id', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'administrador') return res.status(403).json({ success: false, message: 'Sin permiso' });
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ success: false, message: 'No puedes eliminarte a ti mismo' });
    try {
        const rows = await dbQuery(`SELECT id, role FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        if (rows[0].role === 'administrador') return res.status(400).json({ success: false, message: 'No se puede eliminar a otro administrador' });
        await dbQuery(`UPDATE users SET deleted_at=NOW(), is_active=0 WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/admin/users/:id/password', authenticateToken, async (req, res) => {
    if (!['administrador','superadmin'].includes(req.user?.role)) return res.status(403).json({ success: false, message: 'Sin permiso' });
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ success: false, message: 'La contraseña debe tener mínimo 8 caracteres' });
    try {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash(password, 10);
        const rows = await dbQuery(`SELECT id FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        await dbQuery(`UPDATE users SET password_hash=? WHERE id=?`, [hash, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /derive-teams — lista de grupos configurados para derivar
router.get('/derive-teams', authenticateToken, async (_req, res) => {
    try {
        const teams = await dbQuery(`SELECT id, name, description, icon, color, jira_option_id FROM derive_teams WHERE is_active=1 ORDER BY sort_order, id`);
        res.json({ ok: true, teams });
    } catch(e) { res.json({ ok: true, teams: [] }); }
});

// POST /derive-teams — crear grupo
router.post('/derive-teams', authenticateToken, async (req, res) => {
    if (!['administrador','especialista'].includes(req.user?.role)) return res.status(403).json({ ok: false });
    const { name, description, icon, color, jira_option_id, sort_order } = req.body;
    if (!name) return res.status(400).json({ ok: false, message: 'Nombre requerido' });
    try {
        const r = await dbQuery(
            `INSERT INTO derive_teams (name, description, icon, color, jira_option_id, sort_order) VALUES (?,?,?,?,?,?)`,
            [name, description||null, icon||'bi-people', color||'#6b7280', jira_option_id||null, sort_order||0]
        );
        res.json({ ok: true, id: r.insertId });
    } catch(e) { res.status(500).json({ ok: false, message: e.message }); }
});

// PUT /derive-teams/:id — editar grupo
router.put('/derive-teams/:id', authenticateToken, async (req, res) => {
    if (!['administrador','especialista'].includes(req.user?.role)) return res.status(403).json({ ok: false });
    const { name, description, icon, color, jira_option_id, sort_order, is_active } = req.body;
    try {
        await dbQuery(
            `UPDATE derive_teams SET name=?, description=?, icon=?, color=?, jira_option_id=?, sort_order=?, is_active=? WHERE id=?`,
            [name, description||null, icon||'bi-people', color||'#6b7280', jira_option_id||null, sort_order||0, is_active===false?0:1, req.params.id]
        );
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, message: e.message }); }
});

// DELETE /derive-teams/:id — desactivar grupo
router.delete('/derive-teams/:id', authenticateToken, async (req, res) => {
    if (req.user?.role !== 'administrador') return res.status(403).json({ ok: false });
    try {
        await dbQuery(`UPDATE derive_teams SET is_active=0 WHERE id=?`, [req.params.id]);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, message: e.message }); }
});

const WS_ID = 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c'; // workspace ID de Jira Assets

// POST /ticket/:key/derive — derivar ticket a otro grupo
router.post('/ticket/:key/derive', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { team_id, team_name, note, unassign } = req.body;
    if (!team_name || !note) return res.status(400).json({ ok: false, message: 'Grupo y motivo son obligatorios' });
    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const headers = { 'Authorization': `Basic ${b64Auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
        const by = req.user?.full_name || req.user?.username || req.user?.email || 'Sistema';

        // Buscar jira_option_id si se pasó team_id
        let jiraOptionId = null;
        if (team_id) {
            const rows = await dbQuery(`SELECT jira_option_id FROM derive_teams WHERE id=? LIMIT 1`, [team_id]).catch(() => []);
            jiraOptionId = rows[0]?.jira_option_id || null;
        }

        const fields = {};
        // Cambiar "Tipo de Componente" en Jira si el grupo tiene ID configurado
        if (jiraOptionId) {
            fields.customfield_14687 = [{ id: `${WS_ID}:${jiraOptionId}` }];
        }
        // Desasignar si se solicitó
        if (unassign) fields.assignee = null;

        if (Object.keys(fields).length) {
            await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ fields })
            }).catch(() => {});
        }

        // Comentario interno en Jira (visible para todos los grupos)
        const commentLines = [
            `⚠️ TICKET DERIVADO`,
            `Grupo destino: ${team_name}`,
            `Derivado por: ${by}`,
            `Motivo: ${note}`,
            jiraOptionId ? `Routing Jira: campo "Tipo de Componente" actualizado` : `Routing Jira: solo comentario (grupo sin ID Jira configurado)`
        ];
        await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/comment`, {
            method: 'POST', headers,
            body: JSON.stringify({
                body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: commentLines.join('\n') }] }] }
            })
        }).catch(() => {});

        // BD local
        await dbQuery(
            `UPDATE jira_tickets SET derived_to=?, derived_at=NOW(), derived_by=?, derived_note=?${unassign ? ', assigned_to=NULL, assigned_to_name=NULL' : ''} WHERE ticket_key=?`,
            [team_name, by, note, key]
        ).catch(() => {});

        const routingMsg = jiraOptionId ? ' — campo Tipo de Componente actualizado en Jira' : ' — comentario añadido en Jira';
        res.json({ ok: true, message: `Ticket derivado a ${team_name}${routingMsg}` });
    } catch(e) { res.status(500).json({ ok: false, message: e.message }); }
});

// GET /local-wp-cats — categorías guardadas localmente para filtrar "Sin categorizar"
router.get('/local-wp-cats', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT ticket_key, wp_resultado_padre, wp_resultado_hijo FROM jira_tickets WHERE wp_resultado_padre IS NOT NULL`
        );
        const map = {};
        rows.forEach(r => { map[r.ticket_key] = { padre: r.wp_resultado_padre, hijo: r.wp_resultado_hijo }; });
        res.json({ ok: true, cats: map });
    } catch(e) { res.json({ ok: true, cats: {} }); }
});

// GET /gamification — ranking mensual de técnicos por SLA, resoluciones y MTTR
router.get('/gamification', authenticateToken, async (req, res) => {
    try {
        const now  = new Date();
        const from = req.query.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const to   = req.query.to   || now.toISOString().slice(0, 10);
        const rows = await dbQuery(`
            SELECT
                assigned_to_name  AS tec_name,
                COUNT(*)          AS total,
                SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
                SUM(CASE WHEN resolved_at IS NOT NULL AND sla_deadline IS NOT NULL AND resolved_at <= sla_deadline THEN 1 ELSE 0 END) AS sla_met,
                ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, resolved_at) ELSE NULL END)) AS avg_res_min
            FROM jira_tickets
            WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
              AND assigned_to_name IS NOT NULL AND assigned_to_name != ''
            GROUP BY assigned_to_name
            HAVING resolved > 0
            ORDER BY resolved DESC
        `, [from, to]);

        if (!rows.length) return res.json({ ok: true, data: [], from, to });

        const maxRes  = Math.max(...rows.map(r => Number(r.resolved) || 0), 1);
        const mttrVals = rows.filter(r => r.avg_res_min).map(r => Number(r.avg_res_min));
        const minMttr = mttrVals.length ? Math.min(...mttrVals) : 0;
        const maxMttr = mttrVals.length ? Math.max(...mttrVals) : 1;
        const topRes  = Number(rows[0]?.resolved || 0);

        const data = rows.map(r => {
            const resolved = Number(r.resolved) || 0;
            const slaMet   = Number(r.sla_met)  || 0;
            const slaPct   = resolved > 0 ? Math.round((slaMet / resolved) * 100) : 0;
            const resPct   = Math.round((resolved / maxRes) * 100);
            const mttr     = r.avg_res_min ? Number(r.avg_res_min) : null;
            const speedPct = mttr
                ? Math.round(100 - ((mttr - minMttr) / (maxMttr - minMttr || 1)) * 100)
                : 50;
            const score = Math.round(slaPct * 0.4 + resPct * 0.4 + speedPct * 0.2);

            const badges = [];
            if (slaPct === 100 && resolved >= 3) badges.push({ icon: '🎯', label: 'Cero mora' });
            else if (slaPct >= 90) badges.push({ icon: '🏆', label: 'SLA Master' });
            if (resolved === topRes && resolved >= 3) badges.push({ icon: '📦', label: 'Más productivo' });
            if (speedPct === 100 && mttr) badges.push({ icon: '⚡', label: 'Speed resolver' });
            if (resolved >= 10) badges.push({ icon: '🔥', label: 'En racha' });

            return {
                tec_name: r.tec_name,
                total:    Number(r.total) || 0,
                resolved,
                sla_met:  slaMet,
                slaPct,
                avg_res_min: mttr,
                score,
                badges
            };
        }).sort((a, b) => b.score - a.score);

        res.json({ ok: true, data, from, to });
    } catch(e) { res.status(500).json({ ok: false, message: e.message }); }
});


module.exports = router;
            

'use strict';
/**
 * local_panels.js — Endpoints para la vista local autónoma (TK-% only)
 * Equivalente a los paneles Jira pero 100% desde MySQL local.
 *
 * Todos los endpoints usan ticket_key LIKE 'TK-%' para no mezclar con INC-%.
 */

const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { dbQuery }           = require('./helpers');
const { tenantWhere }       = require('../../utils/tenantFilter');

// LOCAL(req, alias?) devuelve el fragmento WHERE para tickets locales + tenant
function LOCAL(req, alias) {
    const p   = alias ? `${alias}.` : '';
    const tid = req.user?.tenant_id;
    const tenantClause = tid ? ` AND ${p}tenant_id = ${parseInt(tid)}` : '';
    return `${p}ticket_key LIKE 'TK-%'${tenantClause}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function slaChip(sla_deadline, resolved_at, status) {
    if (['resuelto','cerrado'].includes(status)) return 'ok';
    if (!sla_deadline) return 'none';
    const now  = Date.now();
    const dead = new Date(sla_deadline).getTime();
    const rem  = dead - now;
    if (rem < 0) return 'breach';
    if (rem < 30 * 60000) return 'critical';
    if (rem < 2 * 3600000) return 'warning';
    return 'ok';
}

function fmt(rows) {
    return rows.map(t => ({
        key:              t.ticket_key,
        summary:          t.summary,
        status:           t.internal_status || 'abierto',
        internal_status:  t.internal_status || 'abierto',
        priority:         t.priority || 'P3',
        reporter:         t.reporter,
        phone:            t.phone,
        urgency:          t.urgency,
        urgency_level:    Number(t.urgency_level) || 1,
        impact:           t.impact,
        component:        t.component,
        app_item:         t.app_item,
        tipologia:        t.tipologia,
        assigned_to:      t.assigned_to,
        assigned_to_name: t.tech_name || t.assigned_to_name || null,
        assigned_at:      t.assigned_at,
        first_response_at:t.first_response_at,
        resolved_at:      t.resolved_at,
        closed_at:        t.closed_at,
        sla_deadline:     t.sla_deadline,
        resolution_note:  t.resolution_note,
        created:          t.created_at,
        device_code:      t.device_code,
        sla_status:       slaChip(t.sla_deadline, t.resolved_at, t.internal_status),
    }));
}

// ── GET /api/jira/local/mis-asig?filter=activos ───────────────────────────────
router.get('/local/mis-asig', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.json({ success: true, data: [] });

        const filter = req.query.filter || 'activos';
        const statusMap = {
            activos:   `NOT IN ('resuelto','cerrado')`,
            pendiente: `= 'pendiente_usuario'`,
            resuelto:  `= 'resuelto'`,
            cerrado:   `= 'cerrado'`,
            todos:     `IS NOT NULL`,
        };
        const statusFilter = statusMap[filter] || statusMap.activos;

        const rows = await dbQuery(`
            SELECT jt.*, u.full_name AS tech_name
            FROM jira_tickets jt
            LEFT JOIN users u ON u.id = jt.assigned_to
            WHERE ${LOCAL(req, 'jt')}
              AND jt.assigned_to = ?
              AND jt.internal_status ${statusFilter}
            ORDER BY jt.sla_deadline ASC, jt.created_at DESC
            LIMIT 200
        `, [userId]);

        // Contadores mini-stats
        const all = await dbQuery(`
            SELECT internal_status, sla_deadline, resolved_at
            FROM jira_tickets
            WHERE ${LOCAL(req)} AND assigned_to = ?
        `, [userId]);

        const now = Date.now();
        let breach = 0, critical = 0, resolved = 0;
        for (const t of all) {
            if (['resuelto','cerrado'].includes(t.internal_status)) { resolved++; continue; }
            if (!t.sla_deadline) continue;
            const rem = new Date(t.sla_deadline).getTime() - now;
            if (rem < 0) breach++;
            else if (rem < 30 * 60000) critical++;
        }

        res.json({
            success: true,
            data: fmt(rows),
            total: rows.length,
            stats: { total: all.length, resolved, breach, critical },
        });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/sin-asig?filter=sin_asignar&sort=DESC ────────────────
router.get('/local/sin-asig', authenticateToken, async (req, res) => {
    try {
        const filter = req.query.filter || 'sin_asignar';
        const sort   = req.query.sort   === 'ASC' ? 'ASC' : 'DESC';

        const WHERE = {
            sin_asignar: `assigned_to IS NULL AND internal_status NOT IN ('resuelto','cerrado')`,
            pendiente:   `internal_status = 'pendiente_usuario'`,
            asignado_n2: `internal_status = 'asignado' AND assigned_to IS NOT NULL`,
            todos:       `internal_status NOT IN ('resuelto','cerrado')`,
        };
        const where = WHERE[filter] || WHERE.sin_asignar;

        const rows = await dbQuery(`
            SELECT jt.*, u.full_name AS tech_name
            FROM jira_tickets jt
            LEFT JOIN users u ON u.id = jt.assigned_to
            WHERE ${LOCAL(req, 'jt')} AND ${where}
            ORDER BY jt.sla_deadline ASC, jt.created_at ${sort}
            LIMIT 200
        `);

        const now = Date.now();
        let breach = 0, critical = 0;
        for (const t of rows) {
            if (!t.sla_deadline) continue;
            const rem = new Date(t.sla_deadline).getTime() - now;
            if (rem < 0) breach++;
            else if (rem < 30 * 60000) critical++;
        }

        res.json({
            success: true,
            data: fmt(rows),
            total: rows.length,
            stats: { total: rows.length, breach, critical },
        });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/en-curso ──────────────────────────────────────────────
router.get('/local/en-curso', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT jt.*, u.full_name AS tech_name
            FROM jira_tickets jt
            LEFT JOIN users u ON u.id = jt.assigned_to
            WHERE ${LOCAL(req, 'jt')}
              AND jt.internal_status NOT IN ('resuelto','cerrado')
            ORDER BY jt.sla_deadline ASC, jt.created_at DESC
            LIMIT 500
        `);
        // Técnicos únicos para el filtro toolbar
        const techs = await dbQuery(`
            SELECT DISTINCT u.id, u.full_name AS name, u.email
            FROM jira_tickets jt
            JOIN users u ON u.id = jt.assigned_to
            WHERE ${LOCAL(req, 'jt')} AND jt.assigned_to IS NOT NULL
              AND jt.internal_status NOT IN ('resuelto','cerrado')
            ORDER BY u.full_name
        `);
        res.json({ success: true, data: fmt(rows), techs, total: rows.length });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/kanban ────────────────────────────────────────────────
router.get('/local/kanban', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT jt.*, u.full_name AS tech_name
            FROM jira_tickets jt
            LEFT JOIN users u ON u.id = jt.assigned_to
            WHERE ${LOCAL(req, 'jt')} AND jt.internal_status NOT IN ('cerrado')
            ORDER BY jt.sla_deadline ASC, jt.created_at DESC
            LIMIT 500
        `);
        const COLS = ['abierto','asignado','en_progreso','pendiente_usuario','resuelto'];
        const grouped = {};
        for (const col of COLS) grouped[col] = [];
        for (const t of fmt(rows)) {
            const col = COLS.includes(t.internal_status) ? t.internal_status : 'abierto';
            grouped[col].push(t);
        }
        res.json({ success: true, data: grouped });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/sla-panel ─────────────────────────────────────────────
router.get('/local/sla-panel', authenticateToken, async (req, res) => {
    try {
        const [kpis, tickets] = await Promise.all([
            dbQuery(`
                SELECT
                    SUM(resolved_at IS NOT NULL AND resolved_at <= sla_deadline) AS dentro_sla,
                    SUM(resolved_at IS NOT NULL AND resolved_at >  sla_deadline) AS fuera_sla,
                    SUM(resolved_at IS NULL AND NOW() > sla_deadline)            AS breach_abiertos,
                    COUNT(*) AS total
                FROM jira_tickets
                WHERE ${LOCAL(req)} AND sla_deadline IS NOT NULL
            `),
            dbQuery(`
                SELECT jt.*, u.full_name AS tech_name,
                    TIMESTAMPDIFF(MINUTE, jt.created_at, NOW()) AS open_min,
                    TIMESTAMPDIFF(MINUTE, jt.created_at, jt.sla_deadline) AS sla_total_min,
                    TIMESTAMPDIFF(MINUTE, NOW(), jt.sla_deadline) AS rem_min
                FROM jira_tickets jt
                LEFT JOIN users u ON u.id = jt.assigned_to
                WHERE ${LOCAL(req, 'jt')}
                  AND jt.sla_deadline IS NOT NULL
                  AND jt.internal_status NOT IN ('resuelto','cerrado')
                ORDER BY jt.sla_deadline ASC
                LIMIT 100
            `),
        ]);
        const k = kpis[0] || {};
        const total = Number(k.total) || 0;
        const dentro = Number(k.dentro_sla) || 0;
        const fuera  = Number(k.fuera_sla)  || 0;
        const breach = Number(k.breach_abiertos) || 0;
        const pct    = (dentro + fuera) > 0 ? Math.round(dentro / (dentro + fuera) * 100) : 100;

        res.json({
            success: true,
            data: {
                kpis: { total, dentro_sla: dentro, fuera_sla: fuera, breach_abiertos: breach, pct },
                tickets: fmt(tickets),
            }
        });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/heatmap ───────────────────────────────────────────────
router.get('/local/heatmap', authenticateToken, async (req, res) => {
    try {
        const [cells, kpis, byDay, byCat] = await Promise.all([
            // Mapa de calor hora x día de semana (últimos 90 días)
            dbQuery(`
                SELECT
                    HOUR(created_at)       AS hora,
                    DAYOFWEEK(created_at)  AS dow,
                    COUNT(*)               AS total
                FROM jira_tickets
                WHERE ${LOCAL(req)} AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                GROUP BY HOUR(created_at), DAYOFWEEK(created_at)
            `),
            // KPIs generales
            dbQuery(`
                SELECT
                    COUNT(*)                                                AS total,
                    SUM(internal_status NOT IN ('resuelto','cerrado'))      AS activos,
                    ROUND(AVG(TIMESTAMPDIFF(MINUTE,created_at,resolved_at))/60,1) AS mttr_h,
                    MAX(DATE(created_at))                                   AS ultimo_dia
                FROM jira_tickets WHERE ${LOCAL(req)}
            `),
            // Por día de semana
            dbQuery(`
                SELECT DAYOFWEEK(created_at) AS dow, COUNT(*) AS total
                FROM jira_tickets
                WHERE ${LOCAL(req)} AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                GROUP BY dow ORDER BY dow
            `),
            // Top categorías
            dbQuery(`
                SELECT COALESCE(tipologia,component,'Sin categoría') AS cat, COUNT(*) AS total
                FROM jira_tickets WHERE ${LOCAL(req)}
                GROUP BY cat ORDER BY total DESC LIMIT 6
            `),
        ]);

        const k = kpis[0] || {};
        const DAYS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        const dayLabels = byDay.map(r => DAYS[Number(r.dow)-1] || r.dow);
        const dayTotals = byDay.map(r => Number(r.total));

        res.json({
            success: true,
            data: {
                cells,
                kpis: {
                    total:   Number(k.total)   || 0,
                    activos: Number(k.activos) || 0,
                    mttr_h:  k.mttr_h || 0,
                },
                byDay: { labels: dayLabels, data: dayTotals },
                byCat,
            }
        });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/historico?email=&desde=&hasta=&q= ────────────────────
router.get('/local/historico', authenticateToken, async (req, res) => {
    try {
        const { email, desde, hasta, q, estado, prioridad } = req.query;
        let sql = `
            SELECT jt.*, u.full_name AS tech_name
            FROM jira_tickets jt
            LEFT JOIN users u ON u.id = jt.assigned_to
            WHERE ${LOCAL(req, 'jt')}
        `;
        const params = [];
        if (email)     { sql += ' AND jt.reporter LIKE ?';                              params.push(`%${email}%`); }
        if (desde)     { sql += ' AND DATE(jt.created_at) >= ?';                        params.push(desde); }
        if (hasta)     { sql += ' AND DATE(jt.created_at) <= ?';                        params.push(hasta); }
        if (estado)    { sql += ' AND jt.internal_status = ?';                          params.push(estado); }
        if (prioridad) { sql += ' AND jt.priority = ?';                                 params.push(prioridad); }
        if (q)         { sql += ' AND (jt.ticket_key LIKE ? OR jt.summary LIKE ?)';     params.push(`%${q}%`, `%${q}%`); }
        sql += ' ORDER BY jt.created_at DESC LIMIT 300';

        const rows = await dbQuery(sql, params);
        res.json({ success: true, data: fmt(rows), total: rows.length });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /api/jira/local/categorias ───────────────────────────────────────────
router.get('/local/categorias', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT
                COALESCE(tipologia,'Sin tipología') AS categoria,
                COALESCE(component,'Sin componente') AS componente,
                COUNT(*) AS total,
                SUM(internal_status IN ('resuelto','cerrado')) AS cerrados,
                ROUND(AVG(TIMESTAMPDIFF(MINUTE,created_at,resolved_at))/60,1) AS mttr_h
            FROM jira_tickets
            WHERE ${LOCAL(req)}
            GROUP BY tipologia, component
            ORDER BY total DESC LIMIT 30
        `);
        res.json({ success: true, data: rows });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── POST /api/jira/local/ticket — Crear ticket local (TK-%) ──────────────────
router.post('/local/ticket', authenticateToken, async (req, res) => {
    const { summary, reporter, phone, description, category_name, priority = 'P3' } = req.body;
    if (!reporter?.trim()) return res.status(400).json({ success: false, message: 'Reporter requerido' });
    if (!summary?.trim())  return res.status(400).json({ success: false, message: 'Asunto requerido' });

    try {
        // Generar siguiente clave TK-%
        const [row] = await dbQuery(
            `SELECT MAX(CAST(SUBSTRING(ticket_key, 4) AS UNSIGNED)) AS max_num
               FROM jira_tickets WHERE ticket_key LIKE 'TK-%'`
        );
        const nextNum = (row?.max_num || 0) + 1;
        const newKey  = `TK-${String(nextNum).padStart(4, '0')}`;

        // SLA según prioridad
        const slaHours = { P1: 4, P2: 8, P3: 24, P4: 72 }[priority] || 24;
        const slaDeadline = new Date(Date.now() + slaHours * 3600000);

        const tenantId = req.user?.tenant_id || null;
        await dbQuery(
            `INSERT INTO jira_tickets
                (ticket_key, summary, description, status, internal_status,
                 priority, reporter, phone, component, sla_deadline, tenant_id, created_at)
             VALUES (?, ?, ?, 'Abierto', 'abierto', ?, ?, ?, ?, ?, ?, NOW())`,
            [newKey, summary.trim(),
             description?.trim() || `Problemas con ${summary.trim()}.`,
             priority,
             reporter.trim(), phone?.trim() || '-',
             category_name?.trim() || 'General',
             slaDeadline, tenantId]
        );

        // Comentario de sistema
        await dbQuery(
            `INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at)
             VALUES (?, 0, ?, 'sistema', NOW())`,
            [newKey, `Ticket registrado por ${reporter.trim()} vía portal local.`]
        ).catch(() => {});

        // Notificar por socket
        const io = req.app.get('io');
        if (io) io.to('jira:agents').emit('ticket:created', { key: newKey, summary: summary.trim(), priority });

        res.json({ success: true, data: { key: newKey, url: null } });
    } catch(e) {
        console.error('[local/ticket POST]', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;

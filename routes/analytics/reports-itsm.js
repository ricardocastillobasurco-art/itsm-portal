// routes/reports-itsm.js — Reportes ITSM + exportación
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }    = require('uuid');
const { ReportJob }     = require('../../src/models');
const { enqueueReport } = require('../../src/queues/index');
const { authenticateToken } = require('../../middleware/auth');
const sequelize = require('../../src/config/database');
const { QueryTypes } = require('sequelize');

// SLA helper expression (inline en SQL)
const SLA_CUMPLIDO = `(
    (internal_status IN ('resuelto','cerrado') AND (sla_deadline IS NULL OR resolved_at <= sla_deadline))
    OR (internal_status NOT IN ('resuelto','cerrado') AND (sla_deadline IS NULL OR sla_deadline >= NOW()))
)`;
const SLA_VENCIDO = `(
    (internal_status IN ('resuelto','cerrado') AND sla_deadline IS NOT NULL AND resolved_at > sla_deadline)
    OR (internal_status NOT IN ('resuelto','cerrado') AND sla_deadline IS NOT NULL AND sla_deadline < NOW())
)`;

// GET /api/reports-itsm/sla-compliance — % cumplimiento SLA por prioridad y agente
router.get('/sla-compliance', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let where = '1=1';
        const rep = [];
        if (startDate) { where += ' AND created_at >= ?'; rep.push(startDate); }
        if (endDate)   { where += ' AND created_at <= ?'; rep.push(endDate + ' 23:59:59'); }

        const byPriority = await sequelize.query(`
            SELECT priority,
                   COUNT(*) AS total,
                   SUM(${SLA_CUMPLIDO}) AS cumplidos,
                   SUM(${SLA_VENCIDO})  AS vencidos,
                   ROUND(100.0 * SUM(${SLA_CUMPLIDO}) / COUNT(*), 1) AS pct_cumplimiento
            FROM jira_tickets
            WHERE ${where}
            GROUP BY priority
            ORDER BY FIELD(priority,'P1','P2','P3','P4')
        `, { replacements: rep, type: QueryTypes.SELECT });

        const byAgent = await sequelize.query(`
            SELECT assigned_to_name AS agente,
                   COUNT(*) AS total,
                   SUM(${SLA_CUMPLIDO}) AS cumplidos,
                   SUM(${SLA_VENCIDO})  AS vencidos,
                   ROUND(100.0 * SUM(${SLA_CUMPLIDO}) / COUNT(*), 1) AS pct
            FROM jira_tickets
            WHERE ${where} AND assigned_to_name IS NOT NULL AND assigned_to_name != ''
            GROUP BY assigned_to_name
            ORDER BY pct ASC
            LIMIT 20
        `, { replacements: rep, type: QueryTypes.SELECT });

        res.json({ success: true, data: { byPriority, byAgent } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/trends — Tendencias de tickets (últimos 30 días)
router.get('/trends', authenticateToken, async (req, res) => {
    try {
        const daily = await sequelize.query(`
            SELECT DATE(jt.created_at) AS fecha,
                   COUNT(DISTINCT jt.id) AS creados,
                   COUNT(DISTINCT th.ticket_id) AS resueltos
            FROM jira_tickets jt
            LEFT JOIN ticket_history th
              ON th.ticket_id = jt.ticket_key
             AND th.evento = 'cierre'
             AND DATE(th.created_at) = DATE(jt.created_at)
            WHERE jt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(jt.created_at)
            ORDER BY fecha ASC
        `, { type: QueryTypes.SELECT });

        const byStatus = await sequelize.query(`
            SELECT internal_status AS status, COUNT(*) AS total
            FROM jira_tickets
            GROUP BY internal_status
            ORDER BY total DESC
        `, { type: QueryTypes.SELECT });

        const byPriority = await sequelize.query(`
            SELECT priority, COUNT(*) AS total
            FROM jira_tickets
            GROUP BY priority
            ORDER BY FIELD(priority,'P1','P2','P3','P4')
        `, { type: QueryTypes.SELECT });

        const byCat = await sequelize.query(`
            SELECT COALESCE(
                NULLIF(wp_resultado_padre,''),
                IF(component NOT REGEXP '^[0-9a-f]{8}-', component, NULL),
                'Sin categoría'
            ) AS categoria,
            COUNT(*) AS total
            FROM jira_tickets
            GROUP BY categoria
            ORDER BY total DESC
            LIMIT 8
        `, { type: QueryTypes.SELECT });

        res.json({ success: true, data: { daily, byStatus, byPriority, byCat } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/agent-load — Carga por agente
router.get('/agent-load', authenticateToken, async (req, res) => {
    try {
        const rows = await sequelize.query(`
            SELECT assigned_to_name AS agente,
                   COUNT(*) AS total_abiertos,
                   SUM(priority = 'P1') AS criticos,
                   SUM(priority = 'P2') AS altos,
                   SUM(sla_deadline IS NOT NULL AND sla_deadline < NOW()) AS en_riesgo,
                   AVG(TIMESTAMPDIFF(HOUR, created_at, IFNULL(resolved_at, NOW()))) AS avg_horas
            FROM jira_tickets
            WHERE internal_status NOT IN ('resuelto','cerrado')
              AND assigned_to_name IS NOT NULL AND assigned_to_name != ''
            GROUP BY assigned_to_name
            ORDER BY total_abiertos DESC
            LIMIT 15
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/agent-dashboard — Dashboard del agente autenticado
router.get('/agent-dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const kpis = await sequelize.query(`
            SELECT
              SUM(internal_status NOT IN ('resuelto','cerrado')) AS mis_abiertos,
              SUM(internal_status NOT IN ('resuelto','cerrado') AND sla_deadline IS NOT NULL AND sla_deadline < DATE_ADD(NOW(), INTERVAL 2 HOUR)) AS en_riesgo,
              SUM(internal_status NOT IN ('resuelto','cerrado') AND sla_deadline IS NOT NULL AND sla_deadline < NOW()) AS vencidos,
              SUM(DATE(resolved_at) = CURDATE()) AS resueltos_hoy
            FROM jira_tickets WHERE assigned_to = ?
        `, { replacements: [userId], type: QueryTypes.SELECT });

        const misTickets = await sequelize.query(`
            SELECT id, ticket_key, summary, priority, internal_status AS status,
                   assigned_to_name, wp_resultado_padre AS category_name,
                   sla_deadline, created_at
            FROM jira_tickets
            WHERE assigned_to = ? AND internal_status NOT IN ('resuelto','cerrado')
            ORDER BY FIELD(priority,'P1','P2','P3','P4'), created_at ASC
            LIMIT 20
        `, { replacements: [userId], type: QueryTypes.SELECT });

        res.json({ success: true, data: { kpis: kpis[0], tickets: misTickets } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/recent-tickets — últimos 20 tickets
router.get('/recent-tickets', authenticateToken, async (req, res) => {
    try {
        const rows = await sequelize.query(`
            SELECT id, ticket_key, summary AS titulo,
                   priority AS prioridad, internal_status AS estado,
                   assigned_to_name AS agente,
                   COALESCE(wp_resultado_padre, component, 'General') AS categoria,
                   CASE
                     WHEN internal_status NOT IN ('resuelto','cerrado') AND sla_deadline IS NOT NULL AND sla_deadline < NOW()
                          THEN 'vencido'
                     WHEN internal_status NOT IN ('resuelto','cerrado') AND sla_deadline IS NOT NULL AND sla_deadline < DATE_ADD(NOW(), INTERVAL 2 HOUR)
                          THEN 'riesgo'
                     ELSE 'ok' END AS sla_status,
                   created_at AS createdAt
            FROM jira_tickets
            ORDER BY created_at DESC
            LIMIT 20
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/reports-itsm/export — Encolar generación de reporte
router.post('/export', authenticateToken, async (req, res) => {
    try {
        const { type = 'csv', filters } = req.body;
        const jobId = uuidv4();

        const reportJob = await ReportJob.create({
            id: jobId, userId: req.user.id, type, filters, status: 'pending',
        });

        // Encolar
        const bullJob = await enqueueReport({ type, filters, userId: req.user.id, reportId: jobId });

        // Escuchar resultado del worker y actualizar DB
        bullJob.finished()
            .then(async (result) => {
                await ReportJob.update(
                    { status: 'done', fileUrl: result.url, rowCount: result.rows, completedAt: new Date() },
                    { where: { id: jobId } }
                );
                const io = req.app.get('io');
                if (io) io.to(`user:${req.user.id}`).emit('report-ready', { jobId, url: result.url });
            })
            .catch(async (err) => {
                await ReportJob.update({ status: 'failed', errorMsg: err.message }, { where: { id: jobId } });
            });

        res.json({ success: true, jobId, message: 'Reporte en cola, recibirás una notificación cuando esté listo.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/jobs — Estado de mis reportes
router.get('/jobs', authenticateToken, async (req, res) => {
    try {
        const jobs = await ReportJob.findAll({
            where: { userId: req.user.id },
            order: [['requested_at', 'DESC']],
            limit: 10,
        });
        res.json({ success: true, data: jobs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

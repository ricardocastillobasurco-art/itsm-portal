'use strict';

// Registro de tiempo por ticket y reporte de horas (por empresa) para facturar el soporte.
//   GET    /api/jira/ticket/:key/time            entradas + total
//   POST   /api/jira/ticket/:key/time            { minutes, note, billable, work_date }
//   DELETE /api/jira/ticket/:key/time/:id        (quien la registró o un administrador)
//   GET    /api/jira/time/report?from&to[&format=csv]   horas de la empresa activa (administrador)

const express = require('express');
const router = express.Router();
// Toda ruta con :key opera solo sobre tickets del tenant del usuario
router.param('key', require('./helpers').ticketTenantGuard());
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { dbQuery } = require('./helpers');
const { tenantId } = require('../../src/utils/tenantScope');

const STAFF = ['administrador', 'especialista', 'agente', 'tecnico', 'superadmin'];
const staffOnly = (req, res, next) => STAFF.includes(req.user?.role) ? next() : res.status(403).json({ success: false, message: 'Solo el personal de TI registra tiempo' });
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

router.get('/ticket/:key/time', authenticateToken, staffOnly, async (req, res) => {
    try {
        const rows = await dbQuery(`SELECT id, user_id, user_name, minutes, billable, note, work_date, created_at FROM ticket_time_entries
                                    WHERE tenant_id = ? AND ticket_key = ? ORDER BY work_date DESC, id DESC`, [tenantId(req), req.params.key]);
        const total = rows.reduce((a, r) => a + Number(r.minutes), 0);
        const billable = rows.filter(r => r.billable).reduce((a, r) => a + Number(r.minutes), 0);
        res.json({ success: true, data: rows.map(r => ({ ...r, mine: String(r.user_id) === String(req.user.id) })), total, billable });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/ticket/:key/time', authenticateToken, staffOnly, async (req, res) => {
    const minutes = parseInt(req.body?.minutes);
    if (!(minutes > 0 && minutes <= 24 * 60)) return res.status(400).json({ success: false, message: 'Indica entre 1 minuto y 24 horas' });
    const workDate = isDate(req.body?.work_date) ? req.body.work_date : today();
    if (workDate > today()) return res.status(400).json({ success: false, message: 'La fecha no puede ser futura' });
    try {
        await dbQuery(`INSERT INTO ticket_time_entries (tenant_id, ticket_key, user_id, user_name, minutes, billable, note, work_date)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenantId(req), req.params.key, String(req.user.id), (req.user.full_name || req.user.username || '').slice(0, 150),
             minutes, req.body?.billable === false ? 0 : 1, String(req.body?.note || '').trim().slice(0, 500) || null, workDate]);
        res.status(201).json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/ticket/:key/time/:id', authenticateToken, staffOnly, async (req, res) => {
    try {
        const [r] = await dbQuery('SELECT user_id FROM ticket_time_entries WHERE id = ? AND tenant_id = ? AND ticket_key = ?',
            [req.params.id, tenantId(req), req.params.key]);
        if (!r) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        if (String(r.user_id) !== String(req.user.id) && !['administrador', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Solo quien lo registró o un administrador puede borrarlo' });
        }
        await dbQuery('DELETE FROM ticket_time_entries WHERE id = ? AND tenant_id = ?', [req.params.id, tenantId(req)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Reporte de horas de la empresa activa ───────────────────────────────────
function csvCell(v) {
    v = v == null ? '' : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

router.get('/time/report', authenticateToken, requireRole('administrador'), async (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : today().slice(0, 8) + '01';
    const to   = isDate(req.query.to) ? req.query.to : today();
    try {
        const rows = await dbQuery(`SELECT e.work_date, e.ticket_key, COALESCE(t.summary, r.summary) AS summary, e.user_name, e.minutes, e.billable, e.note
                                    FROM ticket_time_entries e
                                    LEFT JOIN jira_tickets t ON t.ticket_key = e.ticket_key AND COALESCE(t.tenant_id, 1) = e.tenant_id
                                    LEFT JOIN jira_requirements r ON r.req_key = e.ticket_key AND COALESCE(r.tenant_id, 1) = e.tenant_id
                                    WHERE e.tenant_id = ? AND e.work_date BETWEEN ? AND ? ORDER BY e.work_date, e.ticket_key`, [tenantId(req), from, to]);
        const total = rows.reduce((a, r) => a + Number(r.minutes), 0);
        const billable = rows.filter(r => r.billable).reduce((a, r) => a + Number(r.minutes), 0);
        if (req.query.format === 'csv') {
            const head = ['Fecha', 'Ticket', 'Resumen', 'Técnico', 'Minutos', 'Horas', 'Facturable', 'Nota'];
            const lines = rows.map(r => [r.work_date, r.ticket_key, r.summary, r.user_name, r.minutes, (r.minutes / 60).toFixed(2), r.billable ? 'Sí' : 'No', r.note].map(csvCell).join(','));
            lines.push(['', '', '', 'TOTAL', total, (total / 60).toFixed(2), `Facturable: ${(billable / 60).toFixed(2)} h`, ''].map(csvCell).join(','));
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="horas-${from}-a-${to}.csv"`);
            return res.send('﻿' + [head.join(','), ...lines].join('\r\n'));
        }
        res.json({ success: true, from, to, total, billable, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;

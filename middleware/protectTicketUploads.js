'use strict';

// Protege /uploads/tickets: solo usuarios autenticados y solo archivos adjuntos
// a tickets de su propio tenant (antes se servían públicamente).

const path = require('path');
const { authenticateToken } = require('./auth');
const { executeQuery, equipmentPool } = require('../config/database');
const { tenantId } = require('../src/utils/tenantScope');

async function checkTenant(req, res, next) {
    try {
        const name = path.basename(decodeURIComponent(req.path));
        const [att] = await executeQuery(equipmentPool,
            'SELECT ticket_id FROM ticket_attachments /* tenant_id: se valida por el ticket padre */ WHERE filename = ? LIMIT 1', [name]);
        if (!att) return res.status(404).end();

        const [t] = await executeQuery(equipmentPool,
            `SELECT COALESCE(tenant_id, 1) AS tid FROM tickets /* tenant_id: lectura del dueño del ticket */ WHERE id = ?
             UNION ALL
             SELECT COALESCE(tenant_id, 1) AS tid FROM jira_tickets /* tenant_id: lectura del dueño del ticket */ WHERE ticket_key = ?
             LIMIT 1`, [att.ticket_id, att.ticket_id]);
        if (!t || Number(t.tid) !== tenantId(req)) return res.status(404).end();
        next();
    } catch (e) { next(e); }
}

module.exports = [authenticateToken, checkTenant];

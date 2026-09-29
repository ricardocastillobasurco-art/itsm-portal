'use strict';

// Utilidades de tickets compartidas por todos los tenants.

const { equipmentPool, executeQuery } = require('../../config/database');

// Sala de socket.io de los agentes de un tenant. Los eventos de tickets y
// consultas solo se emiten a la sala del tenant dueño del dato.
function agentsRoom(tenantId) {
    return `jira:agents:t${Number(tenantId) || 1}`;
}

// Sala del dashboard TV de un tenant
function tvRoom(tenantId) {
    return `tv:dashboard:t${Number(tenantId) || 1}`;
}

// ── Claves de ticket locales ────────────────────────────────────────────────
// jira_tickets.ticket_key es único en toda la plataforma y el historial/comentarios
// se enlazan por la clave, así que la numeración local es global (no por tenant).
// La secuencia es atómica (UPDATE ... LAST_INSERT_ID) para que dos creaciones
// simultáneas nunca obtengan la misma clave.
let _tableReady = null;
const _initialized = new Set();

function _ensureTable() {
    if (!_tableReady) {
        _tableReady = executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS ticket_key_sequences (
                prefix     VARCHAR(10) NOT NULL PRIMARY KEY,
                last_value INT UNSIGNED NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e => { _tableReady = null; throw e; });
    }
    return _tableReady;
}

async function nextLocalTicketKey(prefix) {
    if (!/^[A-Z]{2,5}$/.test(prefix)) throw new Error(`Prefijo de ticket inválido: ${prefix}`);
    await _ensureTable();
    if (!_initialized.has(prefix)) {
        // Arranca la secuencia en el mayor número ya usado con ese prefijo
        await executeQuery(equipmentPool,
            `INSERT IGNORE INTO ticket_key_sequences (prefix, last_value)
             SELECT ?, COALESCE(MAX(CAST(SUBSTRING(ticket_key, ?) AS UNSIGNED)), 0)
             FROM jira_tickets /* tenant_id: secuencia global de claves */ WHERE ticket_key LIKE ?`,
            [prefix, prefix.length + 2, `${prefix}-%`]);
        _initialized.add(prefix);
    }
    const r = await executeQuery(equipmentPool,
        'UPDATE ticket_key_sequences SET last_value = LAST_INSERT_ID(last_value + 1) WHERE prefix = ?', [prefix]);
    return `${prefix}-${String(r.insertId).padStart(4, '0')}`;
}

module.exports = { agentsRoom, tvRoom, nextLocalTicketKey };

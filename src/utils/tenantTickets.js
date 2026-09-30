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
// Numeración por empresa: el prefijo lleva el código de la empresa (TK-ACME-0001),
// cada prefijo tiene su propia secuencia y la clave sigue siendo única en toda la
// plataforma (el historial y los comentarios se enlazan por la clave).
// La empresa sin código (la dueña) conserva el formato TK-0001.
// La secuencia es atómica (UPDATE ... LAST_INSERT_ID) para que dos creaciones
// simultáneas nunca obtengan la misma clave.
let _tableReady = null;
const _initialized = new Set();

function _ensureTable() {
    if (!_tableReady) {
        _tableReady = executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS ticket_key_sequences (
                prefix     VARCHAR(20) NOT NULL PRIMARY KEY,
                \`last_value\` INT UNSIGNED NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e => { _tableReady = null; throw e; });
    }
    return _tableReady;
}

const PREFIX_RE = /^[A-Z]{2,5}(-[A-Z0-9]{2,8})?$/;

async function nextLocalTicketKey(prefix) {
    if (!PREFIX_RE.test(prefix)) throw new Error(`Prefijo de ticket inválido: ${prefix}`);
    await _ensureTable();
    if (!_initialized.has(prefix)) {
        // Arranca la secuencia en el mayor número ya usado con ese prefijo exacto
        // (en incidencias y requerimientos; TK-0001 no se confunde con TK-ACME-0001)
        const exact = `^${prefix}-[0-9]+$`;
        await executeQuery(equipmentPool,
            `INSERT IGNORE INTO ticket_key_sequences (prefix, \`last_value\`)
             SELECT ?, GREATEST(
               (SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_key, ?) AS UNSIGNED)), 0) FROM jira_tickets /* tenant_id: secuencia de claves */ WHERE ticket_key REGEXP ?),
               (SELECT COALESCE(MAX(CAST(SUBSTRING(req_key, ?) AS UNSIGNED)), 0) FROM jira_requirements /* tenant_id: secuencia de claves */ WHERE req_key REGEXP ?))`,
            [prefix, prefix.length + 2, exact, prefix.length + 2, exact]);
        _initialized.add(prefix);
    }
    const r = await executeQuery(equipmentPool,
        'UPDATE ticket_key_sequences SET `last_value` = LAST_INSERT_ID(`last_value` + 1) WHERE prefix = ?', [prefix]);
    return `${prefix}-${String(r.insertId).padStart(4, '0')}`;
}

// Código de tickets de la empresa (tenants.ticket_code), con caché de 1 minuto
const _codes = new Map();
async function ticketCodeFor(tenantId) {
    const tid = Number(tenantId) || 1;
    const c = _codes.get(tid);
    if (c && Date.now() - c.at < 60000) return c.code;
    const [row] = await executeQuery(equipmentPool, 'SELECT ticket_code FROM tenants WHERE id = ? LIMIT 1', [tid]).catch(() => []);
    const code = row?.ticket_code || null;
    _codes.set(tid, { code, at: Date.now() });
    return code;
}
const forgetTicketCode = (tenantId) => _codes.delete(Number(tenantId) || 1);

// Asigna a una empresa un código único derivado de su slug (ACME, ACME2...) si no tiene
async function assignTicketCode(tenantId, slug) {
    const tid = Number(tenantId);
    const [row] = await executeQuery(equipmentPool, 'SELECT ticket_code FROM tenants WHERE id = ?', [tid]);
    if (!row || row.ticket_code) return row?.ticket_code || null;
    const clean = String(slug || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
    const base = clean.length >= 2 ? clean : `C${tid}`;
    for (let n = 1; n < 100; n++) {
        const code = n === 1 ? base : `${base.slice(0, 6)}${n}`;
        const [taken] = await executeQuery(equipmentPool, 'SELECT id FROM tenants WHERE ticket_code = ? LIMIT 1', [code]);
        if (!taken) {
            await executeQuery(equipmentPool, 'UPDATE tenants SET ticket_code = ? WHERE id = ? AND ticket_code IS NULL', [code, tid]);
            forgetTicketCode(tid);
            return code;
        }
    }
    return null;
}

// Prefijo de clave local para una empresa: 'TK' → 'TK-ACME' (o 'TK' si no tiene código)
async function localKeyPrefix(base, tenantId) {
    const code = await ticketCodeFor(tenantId);
    return code ? `${base}-${code}` : base;
}

module.exports = { agentsRoom, tvRoom, nextLocalTicketKey, ticketCodeFor, forgetTicketCode, localKeyPrefix, assignTicketCode };

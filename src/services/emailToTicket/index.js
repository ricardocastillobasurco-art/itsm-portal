'use strict';

// Orquestador de "correo a ticket": para cada tenant activo con la función
// 'email_to_ticket' habilitada, lee su buzón y procesa los correos nuevos.

const { executeQuery, equipmentPool } = require('../../../config/database');
const FeatureFlagService = require('../FeatureFlagService');
const { processMessage } = require('./EmailToTicketService');
const logger = require('../../utils/logger');

const FEATURE = 'email_to_ticket';
const PROVIDERS = { graph: require('./providers/graph'), imap: require('./providers/imap') };

function providerFor(cfg) {
  const p = PROVIDERS[String(cfg.provider || 'graph').toLowerCase()];
  if (!p) throw new Error(`Proveedor de correo desconocido: "${cfg.provider}" (usa graph o imap)`);
  return p;
}

async function loadTenant(tenantId) {
  const [t] = await executeQuery(equipmentPool,
    'SELECT id, slug, name, domain, settings, is_active FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  if (!t) return null;
  if (typeof t.settings === 'string') { try { t.settings = JSON.parse(t.settings); } catch { t.settings = {}; } }
  return t;
}

async function configFor(tenantId) {
  const all = await FeatureFlagService.getAll(tenantId);
  const f = all[FEATURE];
  return f ? { enabled: !!f.enabled, config: f.config || {} } : { enabled: false, config: {} };
}

// Procesa el buzón de un tenant. Devuelve un resumen por acción.
async function runTenant(tenantId, { io = null } = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant || !tenant.is_active) throw new Error('Empresa no encontrada o suspendida');
  const { config } = await configFor(tenant.id);
  const provider = providerFor(config);

  const res = await provider.fetchUnread(tenant, config);
  const messages = Array.isArray(res) ? res : res.messages;
  const summary = { leidos: messages.length, created: 0, comment: 0, ignored: 0, duplicate: 0, error: 0 };
  try {
    for (const msg of messages) {
      const r = await processMessage(tenant, config, msg, { io });
      summary[r.action] = (summary[r.action] || 0) + 1;
      // Se marca leído aunque se haya ignorado: el registro evita reprocesarlo
      if (r.action !== 'error') await msg._ack().catch(e => logger.warn(`[email-to-ticket] no se pudo marcar leído: ${e.message}`));
    }
  } finally {
    if (!Array.isArray(res) && res.close) await res.close();
  }
  return summary;
}

async function testTenant(tenantId) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) throw new Error('Empresa no encontrada');
  const { config } = await configFor(tenant.id);
  return providerFor(config).test(tenant, config);
}

let _running = false;
async function runAll({ io = null } = {}) {
  if (_running) return; // evita solapar ciclos si un buzón tarda
  _running = true;
  try {
    const rows = await executeQuery(equipmentPool,
      `SELECT tf.tenant_id AS id FROM tenant_features tf JOIN tenants t ON t.id = tf.tenant_id
       WHERE tf.name = ? AND tf.enabled = 1 AND t.is_active = 1`, [FEATURE]);
    for (const { id } of rows) {
      try {
        const s = await runTenant(id, { io });
        if (s.leidos) logger.info(`[email-to-ticket] tenant ${id}: ${JSON.stringify(s)}`);
      } catch (e) {
        logger.warn(`[email-to-ticket] tenant ${id}: ${e.message}`);
      }
    }
  } finally { _running = false; }
}

module.exports = { runAll, runTenant, testTenant, FEATURE };

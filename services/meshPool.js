'use strict';

// Servidores MeshCentral por empresa.
//
// - COMPARTIDO (por defecto): el servidor de la plataforma. Cada empresa solo ve
//   los grupos de dispositivos que el superadmin le asignó (rmm_tenant_groups) y
//   abre las sesiones remotas con SU cuenta de MeshCentral ("empresa-<id>"), que
//   solo tiene permisos sobre esos grupos. Sin grupos asignados no ve ningún equipo.
// - PROPIO: la empresa tiene su servidor (integración "rmm_dedicado" en Conexiones
//   del superadmin). Ve todos los equipos de ese servidor.
// - SUPERADMIN: ve todo el servidor compartido.

const crypto = require('crypto');
const shared = require('./meshcentral');
const { MeshCentralService } = shared;
const { executeQuery, equipmentPool } = require('../config/database');
const logger = require('../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const FEATURE = 'rmm_dedicado';
const CACHE_MS = 60 * 1000;

const _dedicated = new Map();   // tenantId → { svc, sig }
const _cfgCache  = new Map();   // tenantId → { cfg, ts }
const _groups    = new Map();   // tenantId → { ids:Set, ts }
const _synced    = new Map();   // tenantId → ts de la última sincronización de permisos

const tenantAccount = (tid) => `empresa-${Number(tid)}`;

async function dedicatedConfig(tid) {
  tid = Number(tid);
  const c = _cfgCache.get(tid);
  if (c && Date.now() - c.ts < CACHE_MS) return c.cfg;
  let cfg = null;
  try {
    const FeatureFlagService = require('../src/services/FeatureFlagService');
    const f = (await FeatureFlagService.getAll(tid))[FEATURE];
    let k = f?.config || {};
    // MariaDB devuelve la columna JSON como texto (MySQL 8 como objeto)
    if (typeof k === 'string') { try { k = require('../src/utils/secretBox').openConfig(JSON.parse(k)); } catch (_) { k = {}; } }
    if (f?.enabled && k.base_url && k.username && k.mesh_pass) {
      cfg = { url: k.base_url, publicUrl: k.public_url || k.base_url, user: k.username, pass: k.mesh_pass, loginKey: k.login_secret || '' };
    }
  } catch (e) { logger.warn(`[RMM] Config de servidor propio (empresa ${tid}):`, e.message); }
  _cfgCache.set(tid, { cfg, ts: Date.now() });
  return cfg;
}

// Servicio a usar para una empresa: el propio (si tiene) o el compartido
async function forTenant(tid) {
  tid = Number(tid);
  const cfg = await dedicatedConfig(tid);
  const cur = _dedicated.get(tid);
  if (!cfg) {
    if (cur) { cur.svc.destroy(); _dedicated.delete(tid); }
    return { svc: shared, dedicated: false };
  }
  const sig = crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex');
  if (!cur || cur.sig !== sig) {
    if (cur) cur.svc.destroy();
    _dedicated.set(tid, { svc: new MeshCentralService({ ...cfg, label: `empresa ${tid}` }), sig });
  }
  return { svc: _dedicated.get(tid).svc, dedicated: true, user: cfg.user };
}

async function groupsOf(tid) {
  tid = Number(tid);
  const c = _groups.get(tid);
  if (c && Date.now() - c.ts < CACHE_MS) return c.ids;
  const rows = await q('SELECT mesh_id FROM rmm_tenant_groups WHERE tenant_id = ?', [tid]);
  const ids = new Set(rows.map(r => r.mesh_id));
  _groups.set(tid, { ids, ts: Date.now() });
  return ids;
}

/**
 * Alcance de una petición:
 *   { svc, mode: 'superadmin'|'dedicated'|'shared', meshIds: Set|null (null = sin filtro), sessionUser, tenantId }
 */
async function scopeFor(req) {
  const { tenantId } = require('../src/utils/tenantScope');
  const tid = Number(tenantId(req)) || 1;
  if (req.user?.role === 'superadmin') {
    return { svc: shared, mode: 'superadmin', meshIds: null, sessionUser: null, tenantId: tid };
  }
  const d = await forTenant(tid);
  if (d.dedicated) return { svc: d.svc, mode: 'dedicated', meshIds: null, sessionUser: d.user, tenantId: tid };
  return { svc: shared, mode: 'shared', meshIds: await groupsOf(tid), sessionUser: tenantAccount(tid), tenantId: tid };
}

/**
 * Cuenta de la empresa en el servidor compartido con permisos exactamente sobre
 * sus grupos. Se llama al asignar/quitar grupos y antes de abrir una sesión.
 */
async function syncTenantAccount(tid, { force = false } = {}) {
  tid = Number(tid);
  if (!force && Date.now() - (_synced.get(tid) || 0) < 10 * 60 * 1000) return;
  if (!shared.isConnected()) throw new Error('MeshCentral no disponible');
  const user = tenantAccount(tid);
  await shared.ensureUser(user);
  for (const meshId of await groupsOf(tid)) await shared.grantGroup(user, meshId);
  _synced.set(tid, Date.now());
}

async function revokeTenantGroup(tid, meshId) {
  if (shared.isConnected()) await shared.revokeGroup(tenantAccount(tid), meshId);
  invalidate(tid);
}

// Empresas con servidor propio activo (para el motor de alertas)
async function dedicatedTenants() {
  const rows = await q(`SELECT tenant_id FROM tenant_features /* tenant_id: recorre todas las empresas (job de plataforma) */
                        WHERE name = ? AND enabled = 1`, [FEATURE]).catch(() => []);
  const out = [];
  for (const r of rows) {
    const d = await forTenant(r.tenant_id);
    if (d.dedicated) out.push({ tenantId: Number(r.tenant_id), svc: d.svc });
  }
  return out;
}

function invalidate(tid) {
  if (tid == null) { _cfgCache.clear(); _groups.clear(); _synced.clear(); return; }
  _cfgCache.delete(Number(tid)); _groups.delete(Number(tid)); _synced.delete(Number(tid));
}

module.exports = { scopeFor, forTenant, groupsOf, syncTenantAccount, revokeTenantGroup, dedicatedTenants, invalidate, tenantAccount, shared, FEATURE };

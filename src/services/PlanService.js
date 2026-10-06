'use strict';

// Límites del plan de cada empresa y su uso actual.
//
//   técnicos     → usuarios de TI activos de la empresa (los técnicos externos de tu
//                  equipo de soporte, con acceso multiempresa, no cuentan)
//   equipos      → equipos con agente en los grupos de control remoto de la empresa
//   ia_mes       → conversaciones del chatbot con IA en el mes
//   almacenamiento → adjuntos locales de sus tickets
//
// Los límites salen de PlatformSettings.plan_limits (editables por el superadmin).
// null = sin límite. La empresa 1 (instalación original) no tiene límites.

const { executeQuery, equipmentPool } = require('../../config/database');
const Settings = require('./PlatformSettings');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const STAFF = ['administrador', 'admin', 'especialista', 'agente', 'tecnico'];
const LABELS = { trial: 'Prueba', free: 'Gratis', starter: 'Básico', professional: 'Pro', enterprise: 'Empresa' };
const METRIC_TEXT = {
  technicians: (l) => `Tu plan permite ${l} técnico${l === 1 ? '' : 's'}`,
  devices: (l) => `Tu plan permite ${l} equipos con control remoto`,
  ai_per_month: (l) => `Tu plan incluye ${l} conversaciones con el asistente inteligente al mes`,
  storage_gb: (l) => `Tu plan incluye ${l} GB para adjuntos`,
};
const period = () => new Date().toISOString().slice(0, 7);
const _cache = new Map();   // `${tid}:${metric}` → { v, ts }
const CACHE_MS = 30 * 1000;

async function tenantRow(tid) {
  const [t] = await q('SELECT id, plan, trial_ends_at FROM tenants WHERE id = ?', [tid]);
  return t || null;
}

async function limitsFor(tid) {
  tid = Number(tid);
  if (tid === 1) return { technicians: null, devices: null, ai_per_month: null, storage_gb: null };
  const t = await tenantRow(tid);
  const all = (await Settings.get('plan_limits')) || {};
  const l = { technicians: null, devices: null, ai_per_month: null, storage_gb: null, ...(all[t?.plan] || all.trial || {}) };
  // Pro: equipos incluidos por técnico (compartidos por toda la empresa)
  if (l.devices == null && l.devices_per_technician) l.devices = Math.max(1, await technicians(tid)) * l.devices_per_technician;
  return l;
}

async function cached(tid, metric, fn) {
  const k = `${tid}:${metric}`, c = _cache.get(k);
  if (c && Date.now() - c.ts < CACHE_MS) return c.v;
  const v = await fn();
  _cache.set(k, { v, ts: Date.now() });
  return v;
}

// Sin caché: se consulta al agregar técnicos y debe reflejar el alta anterior al instante
function technicians(tid) {
  return (async () => {
    const [r] = await q(`SELECT COUNT(*) AS n FROM users WHERE COALESCE(tenant_id, 1) = ? AND is_active = 1 AND deleted_at IS NULL
                         AND role IN (${STAFF.map(() => '?').join(',')})`, [tid, ...STAFF]);
    return Number(r.n);
  })();
}

// Equipos con agente en los grupos de la empresa (servidor compartido). Si MeshCentral no
// está disponible devuelve null (no se bloquea nada por no poder medir).
function devices(tid) {
  return cached(tid, 'devices', async () => {
    const groups = await q('SELECT mesh_id FROM rmm_tenant_groups WHERE tenant_id = ?', [tid]).catch(() => []);
    if (!groups.length) return 0;
    const shared = require('../../services/meshcentral');
    if (!shared.isConnected()) return null;
    const r = await shared.getDevices(false).catch(() => null);
    if (!r?.ok) return null;
    const ids = new Set(groups.map(g => g.mesh_id));
    return r.devices.filter(d => ids.has(d.meshId)).length;
  });
}

async function aiThisMonth(tid) {
  const [r] = await q('SELECT value FROM usage_counters WHERE tenant_id = ? AND metric = ? AND period = ?', [tid, 'ai', period()]).catch(() => []);
  return Number(r?.value || 0);
}

async function addAi(tid) {
  await q(`INSERT INTO usage_counters (tenant_id, metric, period, value) VALUES (?, 'ai', ?, 1)
           ON DUPLICATE KEY UPDATE value = value + 1`, [Number(tid), period()]).catch(() => {});
}

// Bytes de adjuntos locales de los tickets de la empresa
function storageBytes(tid) {
  return cached(tid, 'storage', async () => {
    // La columna del tamaño cambia según la instalación (size / size_bytes)
    const cols = new Set((await q(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
                                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_attachments'`).catch(() => [])).map(r => r.c));
    const sizeExpr = cols.has('size') && cols.has('size_bytes') ? 'COALESCE(a.size, a.size_bytes, 0)' : cols.has('size') ? 'COALESCE(a.size, 0)' : cols.has('size_bytes') ? 'COALESCE(a.size_bytes, 0)' : '0';
    const [r] = await q(`SELECT COALESCE(SUM(${sizeExpr}), 0) AS b FROM ticket_attachments a
                         WHERE a.ticket_id IN (SELECT ticket_key FROM jira_tickets WHERE COALESCE(tenant_id, 1) = ?)
                            OR a.ticket_id IN (SELECT req_key FROM jira_requirements WHERE COALESCE(tenant_id, 1) = ?)`, [tid, tid]).catch(() => [{ b: 0 }]);
    return Number(r?.b || 0);
  });
}

async function usage(tid) {
  tid = Number(tid);
  return {
    technicians: await technicians(tid),
    devices: await devices(tid),
    ai_per_month: await aiThisMonth(tid),
    storage_gb: Math.round(await storageBytes(tid) / 1073741824 * 100) / 100,
  };
}

/**
 * Comprueba que agregar `amount` no supere el límite. Lanza error 403 con code PLAN_LIMIT.
 * metric: technicians | devices | ai_per_month | storage_gb (amount en bytes para storage).
 */
async function assertCanAdd(tid, metric, amount = 1) {
  tid = Number(tid);
  if (tid === 1) return;
  const limit = (await limitsFor(tid))[metric];
  if (limit == null) return;
  let used;
  if (metric === 'technicians') used = await technicians(tid);
  else if (metric === 'devices') { used = await devices(tid); if (used == null) return; }
  else if (metric === 'ai_per_month') used = await aiThisMonth(tid);
  else if (metric === 'storage_gb') { used = await storageBytes(tid); if (used + amount > limit * 1073741824) throw limitError(metric, limit); return; }
  if (used + amount > limit) throw limitError(metric, limit);
}

function limitError(metric, limit) {
  return Object.assign(new Error(`${METRIC_TEXT[metric](limit)}. Mejora tu plan para agregar más.`), { status: 403, code: 'PLAN_LIMIT', metric, limit });
}

async function status(tid) {
  tid = Number(tid);
  const t = await tenantRow(tid);
  const limits = await limitsFor(tid);
  const use = await usage(tid);
  const daysLeft = t?.plan === 'trial' && t.trial_ends_at ? Math.max(0, Math.ceil((new Date(t.trial_ends_at) - Date.now()) / 86400000)) : null;
  const near = Object.keys(limits).filter(k => limits[k] != null && use[k] != null && k !== 'devices_per_technician' && use[k] >= limits[k] * 0.8);
  return { plan: t?.plan || 'trial', label: LABELS[t?.plan] || t?.plan, trialEndsAt: t?.trial_ends_at || null, trialDaysLeft: daysLeft,
           limits, usage: use, near, unlimited: tid === 1 };
}

function invalidate(tid) { for (const k of _cache.keys()) if (k.startsWith(`${tid}:`)) _cache.delete(k); }

module.exports = { LABELS, limitsFor, usage, status, assertCanAdd, addAi, invalidate };

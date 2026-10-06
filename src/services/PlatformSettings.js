'use strict';

// Configuración de la PLATAFORMA (no de una empresa), editable por el superadmin.
// Valores JSON en la tabla platform_settings; si no hay valor guardado se usa el
// valor por defecto de DEFAULTS. Caché corta en memoria.

const { executeQuery, equipmentPool } = require('../../config/database');
const platform = require('../config/platform');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const CACHE_MS = 30 * 1000;
let _cache = null, _ts = 0;

const DEFAULTS = {
  // Registro autoservicio: 'invite' (solo con invitación) · 'open' (público) · 'closed'
  signup_mode: 'invite',
  trial_days: 30,
  // Marca de la plataforma (leyenda "Con tecnología de ..." y correos)
  brand_name: platform.PLATFORM_NAME,
  brand_url: '',
  // Límites por plan (null = sin límite). Ver PlanLimitsService.
  plan_limits: {
    free:         { technicians: 2,    devices: 10,   ai_per_month: 100,  storage_gb: 2 },
    trial:        { technicians: null, devices: 50,   ai_per_month: null, storage_gb: 10 },
    starter:      { technicians: 2,    devices: 10,   ai_per_month: 100,  storage_gb: 2 },
    professional: { technicians: null, devices: null, ai_per_month: null, storage_gb: 20, devices_per_technician: 25 },
    enterprise:   { technicians: null, devices: null, ai_per_month: null, storage_gb: 50 },
  },
  // Textos comerciales de la página de planes (los precios los define el superadmin)
  pricing: {
    currency: 'US$',
    pro_per_technician: '',
    extra_device: '',
    managed_per_user: '',
    contact_email: '',
    contact_whatsapp: '',
  },
  // Datos del titular para las páginas legales (/legal/terminos y /legal/privacidad)
  legal: {
    company: '',
    tax_id: '',
    address: '',
    country: 'Perú',
    email: '',
    updated_at: '',
  },
};

async function getAll() {
  if (_cache && Date.now() - _ts < CACHE_MS) return _cache;
  let rows = [];
  try { rows = await q('SELECT `key`, value FROM platform_settings'); } catch (_) { /* tabla aún no creada */ }
  const saved = {};
  for (const r of rows) { try { saved[r.key] = JSON.parse(r.value); } catch (_) { saved[r.key] = r.value; } }
  const out = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = saved[k];
    out[k] = (def && typeof def === 'object' && !Array.isArray(def) && v && typeof v === 'object')
      ? deepMerge(def, v) : (v ?? def);
  }
  _cache = out; _ts = Date.now();
  return out;
}

function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    o[k] = (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') ? deepMerge(a[k], v) : v;
  }
  return o;
}

async function get(key) { return (await getAll())[key]; }

async function set(values = {}) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS)) continue;
    await q(`INSERT INTO platform_settings (\`key\`, value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)`, [k, JSON.stringify(v)]);
  }
  _cache = null;
  return getAll();
}

module.exports = { getAll, get, set, DEFAULTS, invalidate: () => { _cache = null; } };

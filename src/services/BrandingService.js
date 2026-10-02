'use strict';

// Marca de cada empresa (marca blanca): nombre, logo, color, título del portal y
// nombre del equipo de soporte. Fuente: tenant_view_overrides + tenants.
// Caché en memoria por proceso (se invalida al guardar).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

const ASSETS_DIR = path.join(__dirname, '../../uploads/branding');
const ASSETS_URL = '/branding-assets';
const TTL_MS = 60 * 1000;
const LOGO_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_LOGO_BYTES = 1024 * 1024;

const DEFAULTS = Object.freeze({
  companyName: null,
  logoUrl: null,
  primaryColor: '#2563eb',
  supportName: 'Mesa de ayuda TI',
  portalTitle: null,
});

const _cache = new Map();

function _clean(v, max) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null; }
function _color(v) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : null; }

async function get(tid) {
  tid = Number(tid) || 1;
  const hit = _cache.get(tid);
  if (hit && hit.exp > Date.now()) return hit.data;

  let row = {};
  try {
    [row = {}] = await q(`SELECT t.name AS tenant_name, o.company_name, o.logo_url, o.primary_color, o.support_name, o.portal_title
                          FROM tenants t LEFT JOIN tenant_view_overrides o ON o.tenant_id = t.id
                          WHERE t.id = ? LIMIT 1`, [tid]);
  } catch (_) { /* sin tabla aún: valores por defecto */ }
  const companyName = row.company_name || row.tenant_name || null;
  const data = {
    companyName,
    logoUrl:      row.logo_url || null,
    primaryColor: _color(row.primary_color) || DEFAULTS.primaryColor,
    supportName:  row.support_name || DEFAULTS.supportName,
    portalTitle:  row.portal_title || (companyName ? companyName.toUpperCase().slice(0, 60) : 'SERVICIOS TI'),
    customized:   !!(row.company_name || row.logo_url || row.primary_color || row.support_name || row.portal_title),
  };
  _cache.set(tid, { data, exp: Date.now() + TTL_MS });
  return data;
}

async function save(tid, input = {}) {
  tid = Number(tid) || 1;
  const fields = {
    company_name:  _clean(input.companyName, 255),
    primary_color: _color(input.primaryColor),
    support_name:  _clean(input.supportName, 100),
    portal_title:  _clean(input.portalTitle, 60),
  };
  if (input.primaryColor && !fields.primary_color) {
    throw Object.assign(new Error('El color debe tener el formato #RRGGBB'), { status: 400 });
  }
  await q(`INSERT INTO tenant_view_overrides (tenant_id, company_name, primary_color, support_name, portal_title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), primary_color = VALUES(primary_color),
             support_name = VALUES(support_name), portal_title = VALUES(portal_title), updated_at = NOW()`,
    [tid, fields.company_name, fields.primary_color, fields.support_name, fields.portal_title]);
  _cache.delete(tid);
  return get(tid);
}

// Guarda el logo (PNG/JPG/WEBP/GIF, máx. 1 MB). SVG no se acepta: puede llevar scripts.
async function saveLogo(tid, { buffer, mimetype }) {
  tid = Number(tid) || 1;
  const ext = LOGO_TYPES[mimetype];
  if (!ext) throw Object.assign(new Error('El logo debe ser PNG, JPG, WEBP o GIF'), { status: 400 });
  if (!buffer?.length || buffer.length > MAX_LOGO_BYTES) throw Object.assign(new Error('El logo debe pesar menos de 1 MB'), { status: 400 });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const name = `logo-${tid}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(ASSETS_DIR, name), buffer);

  const [old] = await q('SELECT logo_url FROM tenant_view_overrides WHERE tenant_id = ?', [tid]);
  await q(`INSERT INTO tenant_view_overrides (tenant_id, logo_url, created_at, updated_at) VALUES (?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE logo_url = VALUES(logo_url), updated_at = NOW()`, [tid, `${ASSETS_URL}/${name}`]);
  _removeAsset(old?.logo_url);
  _cache.delete(tid);
  return get(tid);
}

async function removeLogo(tid) {
  tid = Number(tid) || 1;
  const [old] = await q('SELECT logo_url FROM tenant_view_overrides WHERE tenant_id = ?', [tid]);
  await q('UPDATE tenant_view_overrides SET logo_url = NULL, updated_at = NOW() WHERE tenant_id = ?', [tid]);
  _removeAsset(old?.logo_url);
  _cache.delete(tid);
  return get(tid);
}

function _removeAsset(url) {
  if (!url || !String(url).startsWith(ASSETS_URL + '/')) return;
  const file = path.join(ASSETS_DIR, path.basename(url));
  fs.promises.unlink(file).catch(() => {});
}

module.exports = { get, save, saveLogo, removeLogo, DEFAULTS, ASSETS_DIR, ASSETS_URL };

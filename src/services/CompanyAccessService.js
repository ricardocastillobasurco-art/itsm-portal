'use strict';

// Técnicos multiempresa (modelo de proveedor de soporte): un técnico de TU equipo
// puede atender a varias empresas cliente con un solo usuario.
//
// - El superadmin le da acceso a cada empresa con un rol (técnico o administrador).
// - El técnico elige la empresa activa; queda en la cookie "empresa_activa", firmada
//   y ligada al usuario (no se puede reutilizar ni alterar).
// - En CADA petición se vuelve a comprobar en la BD que el acceso siga vigente:
//   quitar el acceso tiene efecto inmediato.
// - Nunca se obtiene el rol superadmin por esta vía.

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const COOKIE = 'empresa_activa';
const ROLES = ['especialista', 'administrador'];
const CACHE_MS = 30 * 1000;
const _cache = new Map();   // `${userId}:${tid}` → { role|null, ts }

const secret = () => process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only';
const sign = (userId, tid) => crypto.createHmac('sha256', secret()).update(`empresa:${userId}:${tid}`).digest('base64url');

function cookieValue(userId, tid) { return `${Number(tid)}.${sign(userId, tid)}`; }

function readCookie(req) {
  const raw = req.cookies?.[COOKIE] ?? (String(req.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1];
  return raw ? decodeURIComponent(raw) : null;
}

function parseCookie(userId, value) {
  const m = /^(\d+)\.([A-Za-z0-9_-]{20,})$/.exec(String(value || ''));
  if (!m) return null;
  const tid = Number(m[1]);
  const expected = Buffer.from(sign(userId, tid));
  const got = Buffer.from(m[2]);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got) ? tid : null;
}

async function accessRole(userId, tid) {
  const k = `${userId}:${tid}`;
  const c = _cache.get(k);
  if (c && Date.now() - c.ts < CACHE_MS) return c.role;
  const [r] = await q(`SELECT a.role FROM user_tenant_access a JOIN tenants t ON t.id = a.tenant_id
                       WHERE a.user_id = ? AND a.tenant_id = ? AND COALESCE(t.is_active, 1) = 1 LIMIT 1`, [String(userId), tid]).catch(() => []);
  const role = r && ROLES.includes(r.role) ? r.role : null;
  _cache.set(k, { role, ts: Date.now() });
  return role;
}

/**
 * Aplica la empresa activa a la petición (después de cargar req.user y req.tenant).
 * Devuelve true si se cambió de empresa.
 */
async function applyActive(req, tenantRepo) {
  if (!req.user || req.user.role === 'superadmin') return false;
  const tid = parseCookie(req.user.id, readCookie(req));
  const home = Number(req.user.tenant_id) || 1;
  if (!tid || tid === home) return false;
  const role = await accessRole(req.user.id, tid);
  if (!role) return false;                 // acceso retirado o cookie de otra persona
  const tenant = await tenantRepo.findById(tid);
  if (!tenant) return false;
  req.user.home_tenant_id = home;
  req.user.home_role = req.user.role;
  req.user.tenant_id = tid;
  req.user.role = role;
  req.tenant = tenant;
  return true;
}

// Empresas que puede atender un usuario (la propia primero)
async function companiesOf(user) {
  const home = Number(user.home_tenant_id || user.tenant_id) || 1;
  const rows = await q(`SELECT t.id, t.name, a.role FROM user_tenant_access a JOIN tenants t ON t.id = a.tenant_id
                        WHERE a.user_id = ? AND COALESCE(t.is_active, 1) = 1 ORDER BY t.name`, [String(user.id)]).catch(() => []);
  const [h] = await q('SELECT id, name FROM tenants WHERE id = ?', [home]);
  const list = [{ id: home, name: h?.name || 'Mi empresa', role: user.home_role || user.role, home: true }];
  for (const r of rows) if (Number(r.id) !== home) list.push({ id: Number(r.id), name: r.name, role: r.role, home: false });
  return list.map(c => ({ ...c, active: c.id === Number(user.tenant_id) }));
}

// ── Administración (superadmin) ─────────────────────────────────────────────
async function listForTenant(tid) {
  return q(`SELECT a.id, a.user_id, a.role, a.created_at, u.full_name, u.email, u.tenant_id AS home_tenant_id, t.name AS home_tenant
            FROM user_tenant_access a JOIN users u ON u.id = a.user_id LEFT JOIN tenants t ON t.id = u.tenant_id
            WHERE a.tenant_id = ? ORDER BY u.full_name`, [tid]);
}

async function grant(tid, email, role, grantedBy) {
  tid = Number(tid);
  if (!ROLES.includes(role)) throw Object.assign(new Error('Rol inválido (técnico o administrador)'), { status: 400 });
  const [t] = await q('SELECT id FROM tenants WHERE id = ?', [tid]);
  if (!t) throw Object.assign(new Error('Empresa no encontrada'), { status: 404 });
  const [u] = await q(`SELECT id, role, tenant_id FROM users /* tenant_id: se busca al técnico en toda la plataforma (superadmin) */
                       WHERE LOWER(email) = ? AND deleted_at IS NULL AND is_active = 1 LIMIT 1`, [String(email || '').trim().toLowerCase()]);
  if (!u) throw Object.assign(new Error('No existe un usuario activo con ese correo'), { status: 404 });
  if (u.role === 'superadmin') throw Object.assign(new Error('El superadmin ya tiene acceso a todas las empresas'), { status: 400 });
  if (!['administrador', 'admin', 'especialista', 'agente', 'tecnico'].includes(u.role)) {
    throw Object.assign(new Error('Solo se puede dar acceso a personal de TI (técnicos o administradores)'), { status: 400 });
  }
  if (Number(u.tenant_id || 1) === tid) throw Object.assign(new Error('Ese usuario ya pertenece a esta empresa'), { status: 400 });
  await q(`INSERT INTO user_tenant_access (user_id, tenant_id, role, granted_by, created_at) VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE role = VALUES(role), granted_by = VALUES(granted_by)`, [String(u.id), tid, role, grantedBy ? String(grantedBy) : null]);
  _cache.clear();
  await audit(tid, 'tech_access_granted', grantedBy, { user_id: u.id, role });
}

async function revoke(tid, accessId, revokedBy) {
  const [r] = await q('SELECT user_id FROM user_tenant_access WHERE id = ? AND tenant_id = ?', [accessId, tid]);
  if (!r) throw Object.assign(new Error('Acceso no encontrado'), { status: 404 });
  await q('DELETE FROM user_tenant_access WHERE id = ? AND tenant_id = ?', [accessId, tid]);
  _cache.clear();
  await audit(tid, 'tech_access_revoked', revokedBy, { user_id: r.user_id });
}

async function audit(tid, event, actorId, metadata) {
  await q('INSERT INTO tenant_audit_log (tenant_id, event, actor_id, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
    [tid, event, /^\d+$/.test(String(actorId || '')) ? Number(actorId) : null, JSON.stringify(metadata || {})]).catch(() => {});
}

module.exports = { COOKIE, ROLES, cookieValue, parseCookie, applyActive, companiesOf, accessRole, listForTenant, grant, revoke, audit };

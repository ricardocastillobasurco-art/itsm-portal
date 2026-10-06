'use strict';

// Registro autoservicio de empresas.
//
// Flujo: (invitación) → formulario → código por correo → empresa creada → sesión iniciada
//        → asistente de configuración.
//
// Protección: desafío "no soy un robot" propio (sin servicios externos) + campo trampa +
// tiempo mínimo de llenado; límites por IP y por correo; correos desechables bloqueados;
// una cuenta por dominio de empresa (los correos gratuitos tipo Gmail no "reservan" dominio).

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');
const Settings = require('./PlatformSettings');
const logger = require('../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const secret = () => (process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only') + ':registro';
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });

const CODE_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const LIMITS = { perIpHour: 5, perEmailHour: 4, tenantsPerIpDay: 3 };

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.es', 'ymail.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com',
  'zoho.com', 'mail.com']);
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'tempmailo.com', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempail.com',
  'burnermail.io', 'spamgourmet.com', 'mailnesia.com', 'mytemp.email', '1secmail.com', '1secmail.net', '1secmail.org',
  'moakt.com', 'tmpmail.org', 'tmpmail.net', 'discard.email', 'emailfake.com', 'tempr.email', 'mail.tm', 'inboxkitten.com']);

const emailDomain = (email) => String(email).split('@')[1]?.toLowerCase() || '';
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v || ''));

// ── Configuración pública ───────────────────────────────────────────────────
async function publicConfig(inviteToken) {
  const cfg = await Settings.getAll();
  const out = { mode: cfg.signup_mode, trialDays: cfg.trial_days, brand: cfg.brand_name, invite: null };
  if (inviteToken) {
    try { const inv = await findInvite(inviteToken); out.invite = { email: inv.email, company: inv.company_name, expiresAt: inv.expires_at }; }
    catch (e) { out.inviteError = e.message; }
  }
  return out;
}

// ── Desafío "no soy un robot" (sin estado en el servidor) ───────────────────
const _usedChallenges = new Map();   // firma → expira (evita reutilizar un desafío)
function challenge() {
  const a = crypto.randomInt(2, 10), b = crypto.randomInt(2, 10);
  const payload = Buffer.from(JSON.stringify({ s: a + b, iat: Date.now(), exp: Date.now() + 15 * 60 * 1000, n: crypto.randomBytes(6).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return { question: `¿Cuánto es ${a} + ${b}?`, token: `${payload}.${sig}` };
}

function checkChallenge(token, answer) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) throw fail('Responde la pregunta de verificación', 400, 'CAPTCHA');
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw fail('Verificación inválida, recarga la página', 400, 'CAPTCHA');
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (Date.now() > p.exp) throw fail('La verificación venció, responde la nueva pregunta', 400, 'CAPTCHA');
  if (Date.now() - p.iat < 3000) throw fail('Revisa los datos y vuelve a intentar', 400, 'CAPTCHA');   // demasiado rápido: bot
  if (Number(answer) !== p.s) throw fail('La respuesta de verificación no es correcta', 400, 'CAPTCHA');
  if (_usedChallenges.has(sig)) throw fail('Verificación ya usada, responde la nueva pregunta', 400, 'CAPTCHA');
  _usedChallenges.set(sig, p.exp);
  if (_usedChallenges.size > 5000) for (const [k, exp] of _usedChallenges) if (exp < Date.now()) _usedChallenges.delete(k);
}

// ── Invitaciones ────────────────────────────────────────────────────────────
async function createInvite({ email = null, company = null, note = null, days = 14 } = {}, createdBy = null) {
  if (email && !isEmail(email)) throw fail('Correo inválido');
  days = Math.min(Math.max(parseInt(days) || 14, 1), 90);
  const token = crypto.randomBytes(24).toString('base64url');
  await q(`INSERT INTO signup_invites (token_hash, email, company_name, note, created_by, expires_at)
           VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [sha256(token), email ? email.trim().toLowerCase() : null, company ? String(company).trim().slice(0, 255) : null,
     note ? String(note).trim().slice(0, 500) : null, createdBy ? String(createdBy) : null, days]);
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  return { token, url: `${base}/registro?i=${token}`, days };
}

async function findInvite(token) {
  const [inv] = await q('SELECT * FROM signup_invites WHERE token_hash = ? LIMIT 1', [sha256(token || '')]);
  if (!inv) throw fail('La invitación no existe', 404, 'INVITE');
  if (inv.revoked_at) throw fail('La invitación fue anulada', 410, 'INVITE');
  if (inv.used_at) throw fail('La invitación ya se usó', 410, 'INVITE');
  if (new Date(inv.expires_at) < new Date()) throw fail('La invitación venció; pide una nueva', 410, 'INVITE');
  return inv;
}

async function listInvites() {
  return q(`SELECT i.id, i.email, i.company_name, i.note, i.expires_at, i.used_at, i.revoked_at, i.created_at, t.name AS tenant_name
            FROM signup_invites i LEFT JOIN tenants t ON t.id = i.used_tenant_id ORDER BY i.id DESC LIMIT 200`);
}

async function revokeInvite(id) {
  await q('UPDATE signup_invites SET revoked_at = NOW() WHERE id = ? AND used_at IS NULL', [id]);
}

// ── Paso 1: datos + verificación ────────────────────────────────────────────
async function start(input, ip) {
  const cfg = await Settings.getAll();
  if (cfg.signup_mode === 'closed') throw fail('El registro está cerrado por ahora', 403, 'CLOSED');
  if (input.website) throw fail('Revisa los datos y vuelve a intentar');   // campo trampa: solo lo llenan bots
  checkChallenge(input.challengeToken, input.challengeAnswer);

  let invite = null;
  if (input.invite) invite = await findInvite(input.invite);
  else if (cfg.signup_mode === 'invite') throw fail('Por ahora el registro es solo por invitación', 403, 'INVITE_REQUIRED');

  const email = String(input.email || '').trim().toLowerCase();
  const fullName = String(input.fullName || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const company = String(input.company || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const country = String(input.country || '').trim().slice(0, 60) || null;
  const password = String(input.password || '');
  if (!fullName || fullName.length < 3) throw fail('Escribe tu nombre completo');
  if (!company || company.length < 2) throw fail('Escribe el nombre de tu empresa');
  if (!isEmail(email)) throw fail('Escribe un correo válido');
  if (!input.acceptTerms) throw fail('Debes aceptar los términos y la política de privacidad');
  if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw fail('La contraseña debe tener al menos 10 caracteres, con letras y números');
  }
  if (invite?.email && invite.email !== email) throw fail('Esta invitación es para otro correo', 403, 'INVITE');

  const domain = emailDomain(email);
  if (DISPOSABLE.has(domain)) throw fail('Usa el correo de tu empresa (no se aceptan correos temporales)');
  const [userExists] = await q('SELECT id FROM users /* tenant_id: el correo es único en toda la plataforma */ WHERE LOWER(email) = ? LIMIT 1', [email]);
  if (userExists) throw fail('Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña', 409, 'EMAIL_EXISTS');
  const corporate = FREE_MAIL.has(domain) ? null : domain;
  if (corporate) {
    const [taken] = await q('SELECT name FROM tenants WHERE LOWER(domain) = ? LIMIT 1', [corporate]);
    if (taken) throw fail(`Tu empresa ya tiene una cuenta (${taken.name}). Pide a su administrador que te invite`, 409, 'DOMAIN_EXISTS');
  }

  const [ipCount] = await q('SELECT COUNT(*) AS n FROM signup_requests WHERE ip = ? AND created_at > NOW() - INTERVAL 1 HOUR', [ip]);
  if (Number(ipCount.n) >= LIMITS.perIpHour) throw fail('Demasiados intentos desde tu conexión. Prueba en una hora', 429, 'RATE');
  const [mailCount] = await q('SELECT COUNT(*) AS n FROM signup_requests WHERE email = ? AND created_at > NOW() - INTERVAL 1 HOUR', [email]);
  if (Number(mailCount.n) >= LIMITS.perEmailHour) throw fail('Demasiados intentos con ese correo. Prueba en una hora', 429, 'RATE');
  const [ipTenants] = await q('SELECT COUNT(*) AS n FROM signup_requests WHERE ip = ? AND verified_at > NOW() - INTERVAL 1 DAY', [ip]);
  if (Number(ipTenants.n) >= LIMITS.tenantsPerIpDay) throw fail('Se alcanzó el máximo de empresas registradas desde tu conexión hoy', 429, 'RATE');

  const bcrypt = require('bcrypt');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const r = await q(`INSERT INTO signup_requests (email, full_name, company_name, country, domain, password_hash, invite_id, code_hash, code_plain, ip, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [email, fullName, company, country, corporate, await bcrypt.hash(password, 12), invite?.id || null, sha256(code), code, ip, CODE_MINUTES]);
  const emailQueued = await sendCode(email, fullName, code, cfg.brand_name);
  return { requestId: r.insertId, email, emailQueued, minutes: CODE_MINUTES };
}

async function sendCode(email, name, code, brand) {
  try {
    const { enqueueEmail } = require('../queues/index');
    await enqueueEmail({ to: email, subject: `${code} es tu código de verificación`, template: 'codigo-registro',
      vars: { name, code, brand, minutes: CODE_MINUTES } });
    return true;
  } catch (e) { logger.warn('[registro] No se pudo encolar el correo:', e.message); return false; }
}

async function resend(requestId, ip) {
  const [r] = await q('SELECT * FROM signup_requests WHERE id = ? AND verified_at IS NULL LIMIT 1', [requestId]);
  if (!r) throw fail('Registro no encontrado; vuelve a empezar', 404);
  const [mailCount] = await q('SELECT COUNT(*) AS n FROM signup_requests WHERE email = ? AND created_at > NOW() - INTERVAL 1 HOUR', [r.email]);
  if (Number(mailCount.n) >= LIMITS.perEmailHour + 2) throw fail('Demasiados intentos. Prueba en una hora', 429, 'RATE');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await q(`UPDATE signup_requests SET code_hash = ?, code_plain = ?, attempts = 0, expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
    [sha256(code), code, CODE_MINUTES, r.id]);
  const cfg = await Settings.getAll();
  return { emailQueued: await sendCode(r.email, r.full_name, code, cfg.brand_name) };
}

// ── Paso 2: código correcto → empresa creada ────────────────────────────────
async function verify(requestId, code) {
  const [r] = await q('SELECT * FROM signup_requests WHERE id = ? LIMIT 1', [requestId]);
  if (!r) throw fail('Registro no encontrado; vuelve a empezar', 404);
  if (r.verified_at) throw fail('Este registro ya fue confirmado. Inicia sesión', 409);
  if (new Date(r.expires_at) < new Date()) throw fail('El código venció; pide uno nuevo', 410, 'EXPIRED');
  if (r.attempts >= MAX_ATTEMPTS) throw fail('Demasiados intentos; pide un código nuevo', 429, 'ATTEMPTS');
  const given = String(code || '').replace(/\D/g, '');
  const ok = given.length === 6 && crypto.timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(r.code_hash));
  if (!ok) {
    await q('UPDATE signup_requests SET attempts = attempts + 1 WHERE id = ?', [r.id]);
    throw fail(`Código incorrecto (${MAX_ATTEMPTS - r.attempts - 1} intentos restantes)`, 400, 'CODE');
  }
  // Re-validar: entre el paso 1 y el 2 alguien pudo registrar el mismo correo o dominio
  const [userExists] = await q('SELECT id FROM users /* tenant_id: el correo es único en toda la plataforma */ WHERE LOWER(email) = ? LIMIT 1', [r.email]);
  if (userExists) throw fail('Ese correo ya tiene una cuenta. Inicia sesión', 409, 'EMAIL_EXISTS');
  if (r.domain) {
    const [taken] = await q('SELECT id FROM tenants WHERE LOWER(domain) = ? LIMIT 1', [r.domain]);
    if (taken) throw fail('Tu empresa ya tiene una cuenta. Pide a su administrador que te invite', 409, 'DOMAIN_EXISTS');
  }
  if (r.invite_id) {
    const [inv] = await q('SELECT used_at, revoked_at, expires_at FROM signup_invites WHERE id = ?', [r.invite_id]);
    if (!inv || inv.used_at || inv.revoked_at || new Date(inv.expires_at) < new Date()) throw fail('La invitación ya no es válida', 410, 'INVITE');
  }

  const { tenant, user } = await provision(r);
  await q('UPDATE signup_requests SET verified_at = NOW(), tenant_id = ?, code_plain = NULL WHERE id = ?', [tenant.id, r.id]);
  if (r.invite_id) await q('UPDATE signup_invites SET used_at = NOW(), used_tenant_id = ? WHERE id = ?', [tenant.id, r.invite_id]);
  notifyPlatform(tenant, r).catch(() => {});
  return { tenant, user };
}

async function uniqueSlug(name) {
  const base = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'empresa';
  for (let i = 0; i < 100; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const [x] = await q('SELECT id FROM tenants WHERE slug = ? LIMIT 1', [slug]);
    if (!x) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function provision(r) {
  const cfg = await Settings.getAll();
  const Lifecycle = require('./TenantLifecycleService');
  const tenant = await Lifecycle.create({ name: r.company_name, slug: await uniqueSlug(r.company_name), plan: 'trial',
    domain: r.domain, contactEmail: r.email, settings: { country: r.country, signup: true } }, null);
  const tid = Number(tenant.id);
  await q(`UPDATE tenants SET domain = ?, contact_email = ?, signup_source = ?, trial_ends_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?`,
    [r.domain, r.email, r.invite_id ? 'invitacion' : 'publico', Number(cfg.trial_days) || 30, tid]);

  // Administrador de la empresa (la contraseña ya viene cifrada del paso 1)
  const idp = await require('../utils/userId').newUserIdParts();
  const username = await uniqueUsername(r.email.split('@')[0]);
  const ins = await q(`INSERT INTO users (${idp.cols.map(c => c + ', ').join('')}username, full_name, email, password_hash, role, tenant_id, is_active, is_verified, created_at, updated_at)
                       VALUES (${idp.vals.map(() => '?, ').join('')}?, ?, ?, ?, 'administrador', ?, 1, 1, NOW(), NOW())`,
    [...idp.vals, username, r.full_name, r.email, r.password_hash, tid]);
  const user = { id: idp.id ?? ins.insertId, username, role: 'administrador', tenant_id: tid, email: r.email };

  // Estructura inicial genérica (SLA, categorías, KB, servicios) y grupo de control remoto
  await require('./TenantProvisioningService').copyBaseStructure(tid).catch(e => logger.warn('[registro] Paquete inicial:', e.message));
  await createMeshGroup(tid, r.company_name);
  await q("INSERT INTO tenant_audit_log (tenant_id, event, actor_id, metadata, created_at) VALUES (?, 'tenant.self_signup', NULL, ?, NOW())",
    [tid, JSON.stringify({ email: r.email, invite: !!r.invite_id, country: r.country })]).catch(() => {});
  return { tenant: { ...tenant, id: tid }, user };
}

async function uniqueUsername(base) {
  base = String(base || 'admin').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'admin';
  for (let i = 0; i < 50; i++) {
    const c = i ? `${base}${i + 1}` : base;
    const [x] = await q('SELECT id FROM users /* tenant_id: el usuario es único en la plataforma */ WHERE username = ? LIMIT 1', [c]);
    if (!x) return c;
  }
  return `${base}${Date.now().toString(36)}`;
}

/**
 * Grupo de MeshCentral de la empresa en el servidor compartido. Si MeshCentral no
 * está conectado ahora, queda pendiente y se crea la primera vez que la empresa
 * abre el control remoto (ensurePendingMeshGroup).
 */
async function createMeshGroup(tid, companyName) {
  try {
    const shared = require('../../services/meshcentral');
    if (!shared.isConnected()) throw new Error('sin conexión');
    const name = `${companyName} - Principal`.slice(0, 64);
    const r = await shared.request({ action: 'createmesh', meshname: name, meshtype: 2, desc: 'Registro autoservicio' });
    if (r.result !== 'ok' || !r.meshid) throw new Error(r.result || 'sin respuesta');
    await q('INSERT INTO rmm_tenant_groups (tenant_id, mesh_id, mesh_name) VALUES (?, ?, ?)', [tid, r.meshid, name]);
    shared._send({ action: 'meshes' });
    const pool = require('../../services/meshPool');
    pool.invalidate(tid);
    await pool.syncTenantAccount(tid, { force: true }).catch(() => {});
    return true;
  } catch (e) {
    await q(`UPDATE tenants SET settings = JSON_SET(COALESCE(settings, '{}'), '$.pendingMeshGroup', true) WHERE id = ?`, [tid]).catch(() => {});
    logger.info(`[registro] Grupo de control remoto pendiente para la empresa ${tid} (${e.message})`);
    return false;
  }
}

async function ensurePendingMeshGroup(tid) {
  const [t] = await q(`SELECT name, JSON_UNQUOTE(JSON_EXTRACT(settings, '$.pendingMeshGroup')) AS pending FROM tenants WHERE id = ?`, [tid]);
  if (!t || t.pending !== 'true') return false;
  const ok = await createMeshGroup(tid, t.name);
  if (ok) await q(`UPDATE tenants SET settings = JSON_REMOVE(settings, '$.pendingMeshGroup') WHERE id = ?`, [tid]).catch(() => {});
  return ok;
}

async function notifyPlatform(tenant, r) {
  const { SUPERADMIN_EMAILS } = require('../config/platform');
  const { enqueueEmail } = require('../queues/index');
  for (const to of SUPERADMIN_EMAILS) {
    await enqueueEmail({ to, subject: `Nueva empresa registrada: ${r.company_name}`, template: 'nueva-empresa',
      vars: { company: r.company_name, name: r.full_name, email: r.email, country: r.country || '', invite: !!r.invite_id } }).catch(() => {});
  }
}

// ── Superadmin: registros pendientes y recientes ────────────────────────────
async function listRequests() {
  return q(`SELECT r.id, r.email, r.full_name, r.company_name, r.country, r.attempts, r.expires_at, r.verified_at, r.created_at,
                   CASE WHEN r.verified_at IS NULL AND r.expires_at > NOW() THEN r.code_plain END AS code,
                   t.name AS tenant_name, t.plan
            FROM signup_requests r LEFT JOIN tenants t ON t.id = r.tenant_id ORDER BY r.id DESC LIMIT 100`);
}

module.exports = { publicConfig, challenge, createInvite, findInvite, listInvites, revokeInvite, start, resend, verify,
                   ensurePendingMeshGroup, listRequests, FREE_MAIL, DISPOSABLE };

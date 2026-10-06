'use strict';

// Asistente de configuración inicial de una empresa (onboarding).
// Pasos: marca → equipo de TI → SLA → categorías → cómo reportan los usuarios.
// El avance se guarda en itsm_automations (clave 'onboarding') como JSON:
//   { steps: { marca: ISO, ... }, completed_at, dismissed_at }

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');
const Branding = require('./BrandingService');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

const STEPS = [
  { id: 'marca',      title: 'Tu empresa',            desc: 'Logo, nombre y colores del portal' },
  { id: 'equipo',     title: 'Equipo de TI',          desc: 'Invita a tus técnicos y administradores' },
  { id: 'sla',        title: 'Tiempos de atención',   desc: 'Cuánto tardan en responder y resolver' },
  { id: 'categorias', title: 'Categorías',            desc: 'Tipos de problema que reportan tus usuarios' },
  { id: 'canales',    title: 'Listo para usar',       desc: 'Cómo reportan tus usuarios' },
];
const STAFF_ROLES = ['administrador', 'especialista', 'agente', 'tecnico'];
const INVITE_ROLES = ['especialista', 'administrador'];
const KEY = 'onboarding';

async function _read(tid) {
  const [r] = await q('SELECT value FROM itsm_automations WHERE tenant_id = ? AND `key` = ? LIMIT 1', [tid, KEY]);
  try { return r?.value ? JSON.parse(r.value) : {}; } catch (_) { return {}; }
}
async function _write(tid, state) {
  await q(`INSERT INTO itsm_automations (tenant_id, \`key\`, value) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`, [tid, KEY, JSON.stringify(state)]);
  return state;
}

async function getState(tid) {
  tid = Number(tid);
  const st = await _read(tid);
  const steps = STEPS.map(s => ({ ...s, done: !!st.steps?.[s.id] }));
  const doneCount = steps.filter(s => s.done).length;
  return {
    steps,
    percent: Math.round(doneCount / STEPS.length * 100),
    completed: !!st.completed_at,
    dismissed: !!st.dismissed_at,
    pending: !st.completed_at && !st.dismissed_at,
  };
}

async function markStep(tid, stepId) {
  if (!STEPS.some(s => s.id === stepId)) throw Object.assign(new Error('Paso desconocido'), { status: 400 });
  const st = await _read(tid);
  st.steps = { ...(st.steps || {}), [stepId]: new Date().toISOString() };
  await _write(tid, st);
  return getState(tid);
}

async function complete(tid) {
  const st = await _read(tid);
  st.completed_at = new Date().toISOString();
  await _write(tid, st);
  return getState(tid);
}

// "Omitir por ahora": no vuelve a abrirse solo; se retoma desde Configuración
async function dismiss(tid) {
  const st = await _read(tid);
  st.dismissed_at = new Date().toISOString();
  await _write(tid, st);
  return getState(tid);
}

async function reopen(tid) {
  const st = await _read(tid);
  delete st.dismissed_at; delete st.completed_at;
  await _write(tid, st);
  return getState(tid);
}

// ── Equipo ───────────────────────────────────────────────────────────────────
async function listTeam(tid) {
  return q(`SELECT id, full_name, email, role, is_active, last_login FROM users
            WHERE COALESCE(tenant_id, 1) = ? AND deleted_at IS NULL AND role IN (${STAFF_ROLES.map(() => '?').join(',')})
            ORDER BY FIELD(role, 'administrador', 'especialista', 'agente', 'tecnico'), full_name`, [tid, ...STAFF_ROLES]);
}

function _tempPassword() {
  // Legible y con mayúscula, minúscula, número y símbolo (cumple la política de contraseñas)
  return crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x') + 'A7!';
}

async function _uniqueUsername(base) {
  base = String(base || 'usuario').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'usuario';
  for (let i = 0; i < 50; i++) {
    const candidate = i ? `${base}${i + 1}` : base;
    const [r] = await q('SELECT id FROM users /* tenant_id: el usuario es único en toda la plataforma */ WHERE username = ? LIMIT 1', [candidate]);
    if (!r) return candidate;
  }
  return `${base}${Date.now()}`;
}

/**
 * Invita a una persona al equipo de TI: crea la cuenta con contraseña temporal y
 * le envía un correo. Devuelve la contraseña temporal para que el administrador
 * pueda entregarla en mano si el correo no está configurado.
 */
async function inviteMember(tid, { full_name, email, role }, { inviterName = null, companyName = null } = {}) {
  tid = Number(tid);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const name = String(full_name || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw Object.assign(new Error(`Correo inválido: ${email || '(vacío)'}`), { status: 400 });
  if (!name) throw Object.assign(new Error(`Falta el nombre de ${cleanEmail}`), { status: 400 });
  const userRole = INVITE_ROLES.includes(role) ? role : 'especialista';
  await require('./PlanService').assertCanAdd(tid, 'technicians');   // límite de técnicos del plan

  const [exists] = await q('SELECT id, COALESCE(tenant_id, 1) AS tid, deleted_at FROM users /* tenant_id: el correo es único en toda la plataforma */ WHERE email = ? LIMIT 1', [cleanEmail]);
  if (exists && !exists.deleted_at) {
    throw Object.assign(new Error(Number(exists.tid) === tid ? `${cleanEmail} ya tiene cuenta` : `${cleanEmail} ya está registrado en otra empresa`), { status: 409 });
  }
  if (exists && Number(exists.tid) !== tid) throw Object.assign(new Error(`${cleanEmail} ya está registrado en otra empresa`), { status: 409 });

  const bcrypt = require('bcrypt');
  const temp = _tempPassword();
  const hash = await bcrypt.hash(temp, 12);
  const cols = new Set((await q("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'")).map(r => r.c));
  const passCol = cols.has('password_hash') ? 'password_hash' : 'password';

  let id;
  if (exists) {   // cuenta eliminada antes en esta misma empresa: se reactiva
    await q(`UPDATE users SET full_name = ?, ${passCol} = ?, role = ?, is_active = 1, is_verified = 1, deleted_at = NULL WHERE id = ? AND COALESCE(tenant_id, 1) = ?`,
      [name, hash, userRole, exists.id, tid]);
    id = exists.id;
  } else {
    const username = await _uniqueUsername(cleanEmail.split('@')[0]);
    const idp = await require('../utils/userId').newUserIdParts();
    const r = await q(`INSERT INTO users (${idp.cols.map(c => c + ', ').join('')}username, full_name, email, ${passCol}, role, tenant_id, is_active, is_verified, created_at, updated_at)
                       VALUES (${idp.vals.map(() => '?, ').join('')}?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`, [...idp.vals, username, name, cleanEmail, hash, userRole, tid]);
    id = idp.id ?? r.insertId;
  }

  let emailQueued = false;
  try {
    const { enqueueEmail } = require('../queues/index');
    await enqueueEmail({
      to: cleanEmail,
      subject: `Te invitaron al portal de TI${companyName ? ' de ' + companyName : ''}`.slice(0, 250),
      template: 'invitacion-equipo',
      vars: { name, email: cleanEmail, tempPassword: temp, role: userRole === 'administrador' ? 'Administrador' : 'Técnico',
              company: companyName || '', inviter: inviterName || '' },
    });
    emailQueued = true;
  } catch (_) { /* sin correo: el administrador entrega la contraseña */ }

  require('./PlanService').invalidate(tid);
  return { id, full_name: name, email: cleanEmail, role: userRole, tempPassword: temp, emailQueued };
}

// ── SLA ──────────────────────────────────────────────────────────────────────
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

async function getSla(tid) {
  const rows = await q('SELECT prioridad, tiempo_respuesta_h AS resp, tiempo_resolucion_h AS resol FROM sla_policies WHERE tenant_id = ?', [tid]);
  const own = Object.fromEntries(rows.map(r => [r.prioridad, { resp: Number(r.resp), resol: Number(r.resol) }]));
  const { STARTER } = require('./TenantProvisioningService');
  const def = Object.fromEntries(STARTER.sla.map(([p, a, b]) => [p, { resp: a, resol: b }]));
  return PRIORITIES.map(p => ({ prioridad: p, ...(own[p] || def[p]), custom: !!own[p] }));
}

async function saveSla(tid, input = {}) {
  const rows = [];
  for (const p of PRIORITIES) {
    const v = input[p] || {};
    const resp = Number(v.resp), resol = Number(v.resol);
    if (!(resp > 0 && resol > 0)) throw Object.assign(new Error(`${p}: indica horas mayores a 0`), { status: 400 });
    if (resp > resol) throw Object.assign(new Error(`${p}: la respuesta no puede ser mayor que la resolución`), { status: 400 });
    if (resol > 720) throw Object.assign(new Error(`${p}: máximo 720 horas (30 días)`), { status: 400 });
    rows.push([p, Math.round(resp * 100) / 100, Math.round(resol * 100) / 100]);
  }
  // Única por (tenant_id, prioridad): una sola sentencia (con valores iguales,
  // un UPDATE informa 0 filas cambiadas y no sirve para saber si la fila existe)
  for (const [p, resp, resol] of rows) {
    await q(`INSERT INTO sla_policies (tenant_id, prioridad, tiempo_respuesta_h, tiempo_resolucion_h, created_at, updated_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE tiempo_respuesta_h = VALUES(tiempo_respuesta_h),
               tiempo_resolucion_h = VALUES(tiempo_resolucion_h), updated_at = NOW()`, [tid, p, resp, resol]);
  }
  return getSla(tid);
}

// ── Resumen para el último paso ─────────────────────────────────────────────
async function summary(tid) {
  const [t] = await q('SELECT name, domain, slug FROM tenants WHERE id = ?', [tid]);
  const [cats] = await q('SELECT COUNT(*) AS n FROM ticket_categories WHERE tenant_id = ? AND is_active = 1', [tid]).catch(() => [{ n: 0 }]);
  const team = await listTeam(tid);
  const brand = await Branding.get(tid);
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  return {
    company: brand.companyName || t?.name,
    domain: t?.domain || null,
    portalUrl: `${appUrl}/autogestion`,
    loginUrl: `${appUrl}/api/auth/login`,
    team: team.length,
    categories: Number(cats?.n || 0),
  };
}

module.exports = { STEPS, getState, markStep, complete, dismiss, reopen, listTeam, inviteMember, getSla, saveSla, summary };

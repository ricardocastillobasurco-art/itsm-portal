'use strict';

// "Primeros pasos" de una empresa nueva: lista de tareas calculada con datos reales
// (no se marca a mano) y serie de correos de bienvenida (días 0, 2 y 7) para las
// empresas creadas desde el registro. Los correos los envía el job horario.

const { executeQuery, equipmentPool } = require('../../config/database');
const logger = require('../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const KEY = 'checklist';
const STAFF = ['administrador', 'admin', 'especialista', 'agente', 'tecnico'];
const WELCOME_DAYS = [0, 2, 7];

const count = async (sql, params) => Number((await q(sql, params).catch(() => [{ n: 0 }]))[0]?.n || 0);

async function _flags(tid) {
  const [r] = await q('SELECT value FROM itsm_automations WHERE tenant_id = ? AND `key` = ? LIMIT 1', [tid, KEY]).catch(() => []);
  try { return r?.value ? JSON.parse(r.value) : {}; } catch (_) { return {}; }
}

async function checklist(tid) {
  tid = Number(tid);
  const onboarding = await require('./OnboardingService').getState(tid).catch(() => ({ completed: false }));
  const staff = await count(`SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role IN (${STAFF.map(() => '?').join(',')}) AND is_active = 1 AND deleted_at IS NULL`, [tid, ...STAFF]);
  const endUsers = await count("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role IN ('usuario', 'visor') AND is_active = 1 AND deleted_at IS NULL", [tid]);
  const tickets = await count('SELECT COUNT(*) AS n FROM tickets WHERE tenant_id = ? AND deleted_at IS NULL', [tid])
                + await count('SELECT COUNT(*) AS n FROM service_requests WHERE tenant_id = ? AND deleted_at IS NULL', [tid]);
  let devices = 0;
  try { devices = Number((await require('./PlanService').usage(tid)).devices || 0); } catch (_) {}

  const items = [
    { id: 'configurar', title: 'Configura tu portal', desc: 'Logo, tiempos de atención y categorías', href: '/bienvenida', done: !!(onboarding.completed || onboarding.dismissed) },
    { id: 'tecnico',    title: 'Invita a un técnico', desc: 'Atiendan los tickets en equipo',           href: '/bienvenida', done: staff >= 2 },
    { id: 'ticket',     title: 'Crea tu primer ticket', desc: 'Pruébalo como lo haría un usuario',       href: '/autogestion', done: tickets >= 1 },
    { id: 'agente',     title: 'Instala el agente en un equipo', desc: 'Para conectarte en remoto desde el ticket', href: '/rmm', done: devices >= 1 },
    { id: 'usuarios',   title: 'Suma a tus usuarios', desc: 'Comparte el portal de autoservicio',       href: '/bienvenida', done: endUsers >= 1 },
  ];
  const done = items.filter(i => i.done).length;
  const flags = await _flags(tid);
  return { items, done, total: items.length, dismissed: !!flags.dismissed_at, complete: done === items.length };
}

async function dismiss(tid) {
  const flags = await _flags(tid);
  flags.dismissed_at = new Date().toISOString();
  await q(`INSERT INTO itsm_automations (tenant_id, \`key\`, value) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`, [tid, KEY, JSON.stringify(flags)]);
}

// ── Correos de bienvenida ───────────────────────────────────────────────────
// Solo empresas del registro autoservicio, durante sus primeros 10 días. Si el
// job estuvo detenido, se envía solo el correo más reciente que corresponda.
async function runWelcomeSeries() {
  let sent = 0;
  const rows = await q(`SELECT id, name, settings, TIMESTAMPDIFF(HOUR, created_at, NOW()) AS hours FROM tenants
                        WHERE signup_source IS NOT NULL AND is_active = 1 AND id <> 1 AND created_at > NOW() - INTERVAL 10 DAY`);
  for (const t of rows) {
    const age = Math.floor(Number(t.hours) / 24);
    const day = [...WELCOME_DAYS].reverse().find(d => age >= d);
    if (day == null) continue;
    let done = [];
    try { done = (JSON.parse(t.settings || '{}').welcomeEmails) || []; } catch (_) {}
    if (done.some(d => d >= day)) continue;
    const list = await checklist(t.id);
    const pending = list.items.filter(i => !i.done).map(i => ({ title: i.title, desc: i.desc, href: i.href }));
    if (day > 0 && !pending.length) {
      // Ya hizo todo: no hace falta insistir
    } else {
      const brand = (await require('./PlatformSettings').get('brand_name')) || 'Portal TI';
      const subject = day === 0 ? `Bienvenido a ${brand}` : day === 2 ? 'Tus primeros pasos' : '¿Cómo te va con tu mesa de ayuda?';
      const admins = await q(`SELECT email, full_name FROM users WHERE tenant_id = ? AND role IN ('administrador', 'admin') AND is_active = 1 AND deleted_at IS NULL`, [t.id]);
      for (const a of admins) {
        await require('../queues/index').enqueueEmail({ to: a.email, subject, template: 'bienvenida-serie',
          vars: { name: a.full_name, brand, company: t.name, day, pending, done: list.done, total: list.total } }).catch(e => logger.warn('[bienvenida] correo:', e.message));
      }
      sent++;
    }
    await q(`UPDATE tenants SET settings = JSON_SET(COALESCE(settings, '{}'), '$.welcomeEmails', JSON_EXTRACT(?, '$')) WHERE id = ?`,
      [JSON.stringify([...done, day]), t.id]);
  }
  if (sent) logger.info(`[bienvenida] ${sent} correo(s) de bienvenida`);
  return { sent };
}

// Empresas del registro sin actividad en 60 días (nadie inició sesión). No se borran
// solas: se listan en el panel comercial para que el superadmin decida.
async function inactive(days = 60) {
  return q(`SELECT t.id, t.name, t.plan, t.contact_email, t.created_at, MAX(u.last_login) AS last_login
            FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id
            WHERE t.signup_source IS NOT NULL AND t.is_active = 1 AND t.id <> 1 AND t.plan IN ('trial', 'free')
              AND t.created_at < NOW() - INTERVAL ${Number(days)} DAY
            GROUP BY t.id, t.name, t.plan, t.contact_email, t.created_at
            HAVING last_login IS NULL OR last_login < NOW() - INTERVAL ${Number(days)} DAY
            ORDER BY last_login LIMIT 100`);
}

module.exports = { checklist, dismiss, runWelcomeSeries, inactive, WELCOME_DAYS };

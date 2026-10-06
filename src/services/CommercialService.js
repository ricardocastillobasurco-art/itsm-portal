'use strict';

// Lado comercial de la plataforma:
//  - Solicitudes desde el producto: "Quiero el plan Pro" / "Contratar soporte gestionado".
//  - Resumen comercial para el superadmin (registros, pruebas, pagos, solicitudes).
//  - Cobro manual (tenant_billing): aviso al cliente 7 días antes del vencimiento y,
//    si vence sin pago, se marca "vencido" y se avisa al superadmin (no se corta nada solo).

const { executeQuery, equipmentPool } = require('../../config/database');
const logger = require('../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const TYPES = { pro: 'Plan Pro', managed: 'Soporte gestionado' };
const STATUSES = ['nuevo', 'contactado', 'ganado', 'perdido'];

async function superadminEmails() {
  const { SUPERADMIN_EMAILS } = require('../config/platform');
  if (SUPERADMIN_EMAILS.length) return SUPERADMIN_EMAILS;
  const rows = await q("SELECT email FROM users /* tenant_id: superadmins de la plataforma */ WHERE role = 'superadmin' AND is_active = 1 AND deleted_at IS NULL").catch(() => []);
  return rows.map(r => r.email).filter(Boolean);
}

async function enqueue(to, subject, template, vars) {
  try { await require('../queues/index').enqueueEmail({ to, subject, template, vars }); } catch (e) { logger.warn('[comercial] correo:', e.message); }
}

// ── Solicitudes desde el producto ───────────────────────────────────────────
async function createRequest(tid, user, type, input = {}) {
  if (!TYPES[type]) throw fail('Tipo de solicitud inválido');
  const [recent] = await q("SELECT COUNT(*) AS n FROM sales_requests WHERE tenant_id = ? AND created_at > NOW() - INTERVAL 1 DAY", [tid]);
  if (Number(recent.n) >= 3) throw fail('Ya recibimos tus solicitudes de hoy; te contactaremos pronto', 429);
  const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const data = {
    users: Math.max(0, parseInt(input.users) || 0) || null,
    devices: Math.max(0, parseInt(input.devices) || 0) || null,
    technicians: Math.max(0, parseInt(input.technicians) || 0) || null,
    schedule: ['8x5', '12x6', '24x7'].includes(input.schedule) ? input.schedule : null,
    phone: clean(input.phone, 40) || null,
    message: clean(input.message, 1000) || null,
  };
  const contact = `${user.full_name || user.username || ''} <${user.email || ''}>`.trim();
  const r = await q(`INSERT INTO sales_requests (tenant_id, type, data, created_by, contact) VALUES (?, ?, ?, ?, ?)`,
    [tid, type, JSON.stringify(data), String(user.id), contact.slice(0, 255)]);
  const [t] = await q('SELECT name, plan FROM tenants WHERE id = ?', [tid]);
  for (const to of await superadminEmails()) {
    await enqueue(to, `${TYPES[type]}: ${t?.name || 'empresa ' + tid}`, 'solicitud-comercial',
      { type: TYPES[type], company: t?.name || '', plan: t?.plan || '', contact, ...data });
  }
  await q("INSERT INTO tenant_audit_log (tenant_id, event, actor_id, metadata, created_at) VALUES (?, 'sales.request', NULL, ?, NOW())",
    [tid, JSON.stringify({ type, by: user.email })]).catch(() => {});
  return { id: r.insertId };
}

async function listRequests({ status } = {}) {
  const where = STATUSES.includes(status) ? 'WHERE r.status = ?' : '';
  const rows = await q(`SELECT r.*, t.name AS tenant_name, t.plan FROM sales_requests r JOIN tenants t ON t.id = r.tenant_id
                        ${where} ORDER BY FIELD(r.status, 'nuevo', 'contactado', 'ganado', 'perdido'), r.id DESC LIMIT 200`, where ? [status] : []);
  return rows.map(r => { let d = {}; try { d = JSON.parse(r.data || '{}'); } catch (_) {} return { ...r, data: d, typeLabel: TYPES[r.type] || r.type }; });
}

async function updateRequest(id, { status, notes }) {
  if (status !== undefined && !STATUSES.includes(status)) throw fail('Estado inválido');
  const r = await q(`UPDATE sales_requests SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?`,
    [status ?? null, notes !== undefined ? String(notes).slice(0, 2000) : null, id]);
  if (!r.affectedRows) throw fail('Solicitud no encontrada', 404);
}

// ── Resumen comercial ───────────────────────────────────────────────────────
async function summary() {
  const byPlan = await q('SELECT plan, COUNT(*) AS n FROM tenants WHERE is_active = 1 AND id <> 1 GROUP BY plan');
  const plans = Object.fromEntries(byPlan.map(r => [r.plan, Number(r.n)]));
  const [signups] = await q("SELECT COUNT(*) AS n FROM tenants WHERE signup_source IS NOT NULL AND created_at > NOW() - INTERVAL 30 DAY");
  const [ending] = await q("SELECT COUNT(*) AS n FROM tenants WHERE plan = 'trial' AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL 7 DAY");
  const [openReq] = await q("SELECT COUNT(*) AS n FROM sales_requests WHERE status IN ('nuevo', 'contactado')").catch(() => [{ n: 0 }]);
  const [overdue] = await q("SELECT COUNT(*) AS n FROM tenant_billing WHERE status = 'overdue'").catch(() => [{ n: 0 }]);
  const paidMonth = await q(`SELECT currency, SUM(amount) AS total FROM tenant_billing
                             WHERE status = 'paid' AND DATE_FORMAT(updated_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') GROUP BY currency`).catch(() => []);
  const trials = await q(`SELECT t.id, t.name, t.trial_ends_at, t.contact_email, t.signup_source
                          FROM tenants t WHERE t.plan = 'trial' AND t.id <> 1 ORDER BY t.trial_ends_at LIMIT 50`);
  return {
    plans, paying: (plans.professional || 0) + (plans.enterprise || 0),
    signups30: Number(signups.n), trialsEnding7: Number(ending.n), openRequests: Number(openReq.n), overdue: Number(overdue.n),
    paidThisMonth: paidMonth.map(r => ({ currency: r.currency, total: Number(r.total) })),
    trials,
  };
}

// ── Cobro manual: avisos ────────────────────────────────────────────────────
async function billingRun() {
  let reminded = 0, overdue = 0;
  // 7 días antes del vencimiento → aviso a los administradores del cliente (una vez)
  const soon = await q(`SELECT b.*, t.name FROM tenant_billing b JOIN tenants t ON t.id = b.tenant_id
                        WHERE b.status = 'pending' AND b.reminder_sent_at IS NULL AND b.renewal_date IS NOT NULL
                          AND b.renewal_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY`).catch(() => []);
  for (const b of soon) {
    const admins = await q(`SELECT email, full_name FROM users WHERE COALESCE(tenant_id, 1) = ? AND role IN ('administrador', 'admin') AND is_active = 1 AND deleted_at IS NULL`, [b.tenant_id]);
    for (const a of admins) {
      await enqueue(a.email, `Recordatorio de pago · ${b.name}`, 'cobro-aviso',
        { name: a.full_name, company: b.name, amount: b.amount, currency: b.currency, date: String(b.renewal_date).slice(0, 10) });
    }
    await q('UPDATE tenant_billing SET reminder_sent_at = NOW() WHERE id = ?', [b.id]);
    reminded++;
  }
  // Vencido sin pago → "vencido" + aviso al superadmin (no se corta el servicio automáticamente)
  const late = await q(`SELECT b.*, t.name FROM tenant_billing b JOIN tenants t ON t.id = b.tenant_id
                        WHERE b.status IN ('pending', 'overdue') AND b.overdue_notified_at IS NULL
                          AND b.renewal_date IS NOT NULL AND b.renewal_date < CURDATE()`).catch(() => []);
  for (const b of late) {
    await q("UPDATE tenant_billing SET status = 'overdue', overdue_notified_at = NOW() WHERE id = ?", [b.id]);
    for (const to of await superadminEmails()) {
      await enqueue(to, `Pago vencido: ${b.name}`, 'solicitud-comercial',
        { type: 'Pago vencido', company: b.name, plan: '', contact: '', message: `Venció el ${String(b.renewal_date).slice(0, 10)} · ${b.currency} ${b.amount ?? ''}` });
    }
    overdue++;
  }
  if (reminded || overdue) logger.info(`[cobros] ${reminded} recordatorio(s), ${overdue} vencido(s)`);
  return { reminded, overdue };
}

module.exports = { TYPES, STATUSES, createRequest, listRequests, updateRequest, summary, billingRun };

'use strict';

// Motor de la gestión local de tickets (sin Jira). Todos los canales (portal,
// panel de TI, chatbot, correo, API) crean y actualizan tickets por aquí, así la
// empresa tiene las mismas reglas venga el ticket de donde venga:
//   - SLA según la política de la empresa (SLAPolicy), pausado en "pendiente_usuario"
//   - Reglas de cambio de estado (no se puede, p. ej., pasar de cerrado a abierto)
//   - Asignación solo a técnicos de la misma empresa
//   - Avisos por correo al usuario y al técnico, encuesta al resolver
//   - Cierre automático de resueltos sin respuesta
//
// Incidencias → jira_tickets (TK-XXXX) · Requerimientos → jira_requirements (RQ-XXXX)
// (las tablas conservan el nombre histórico "jira_*" pero aquí son 100% locales)

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../../config/database');
const { nextLocalTicketKey, agentsRoom, localKeyPrefix } = require('../../utils/tenantTickets');
const logger = require('../../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

const KINDS = {
  incident:    { table: 'jira_tickets',      keyCol: 'ticket_key', prefix: 'TK', label: 'incidencia' },
  requirement: { table: 'jira_requirements', keyCol: 'req_key',    prefix: 'RQ', label: 'requerimiento' },
};
const kindOfKey = (key) => (/^RQ-/i.test(key) ? 'requirement' : 'incident');

const STATUS_LABEL = {
  abierto: 'Abierto', asignado: 'Asignado', en_progreso: 'En progreso',
  pendiente_usuario: 'Pendiente', resuelto: 'Resuelto', cerrado: 'Cerrado',
};
// Transiciones permitidas. Reabrir un resuelto/cerrado se hace con reopen() (pide motivo).
const TRANSITIONS = {
  abierto:           ['asignado', 'en_progreso', 'pendiente_usuario', 'resuelto', 'cerrado'],
  asignado:          ['abierto', 'en_progreso', 'pendiente_usuario', 'resuelto', 'cerrado'],
  en_progreso:       ['asignado', 'pendiente_usuario', 'resuelto', 'cerrado'],
  pendiente_usuario: ['asignado', 'en_progreso', 'resuelto', 'cerrado'],
  resuelto:          ['cerrado'],
  cerrado:           [],
};
const STAFF_ROLES = ['administrador', 'admin', 'especialista', 'agente', 'tecnico', 'superadmin'];
const SLA_FALLBACK_H = { P1: 1, P2: 4, P3: 8, P4: 24 };
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

class TicketError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ── Utilidades ──────────────────────────────────────────────────────────────
async function automation(tid) {
  try { return await require('../../../routes/jira/helpers').getAutomationConfig(tid); } catch (_) { return {}; }
}

async function slaHours(tid, priority) {
  try {
    const { SLAPolicy } = require('../../models');
    const p = await SLAPolicy.forTenant(tid, priority);
    if (p?.tiempoResolucionH) return Number(p.tiempoResolucionH);
  } catch (_) {}
  return SLA_FALLBACK_H[priority] || 8;
}

const appUrl = () => (process.env.APP_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

async function notify(to, subject, vars) {
  if (!isEmail(to)) return;
  try {
    const { enqueueEmail } = require('../../queues/index');
    await enqueueEmail({ to, subject: subject.slice(0, 250), template: 'ticket-evento', vars });
  } catch (e) { logger.warn(`[local-tickets] aviso no encolado a ${to}: ${e.message}`); }
}

function emit(io, tid, event, payload) {
  try { if (io) io.to(agentsRoom(tid)).emit(event, payload); } catch (_) {}
}

async function history(key, actor, evento, detalle) {
  await q(`INSERT INTO ticket_history /* tenant_id: ticket validado en el tenant */ (ticket_id, user_id, user_name, evento, detalle)
           VALUES (?, ?, ?, ?, ?)`, [key, actor?.id || 0, actor?.name || 'Sistema', evento, String(detalle).slice(0, 2000)]).catch(() => {});
}

// Ticket del tenant (o error 404): nunca se opera sobre tickets de otra empresa
async function load(tid, key) {
  const k = KINDS[kindOfKey(key)];
  const [row] = await q(`SELECT * FROM ${k.table} WHERE ${k.keyCol} = ? AND COALESCE(tenant_id, 1) = ? LIMIT 1`, [key, tid]);
  if (!row) throw new TicketError('Ticket no encontrado', 404);
  return { row, k, kind: kindOfKey(key) };
}

async function staffUser(tid, { userId, email }) {
  const [u] = await q(`SELECT id, full_name, username, email, role FROM users
                       WHERE ${userId ? 'id = ?' : 'LOWER(email) = ?'} AND COALESCE(tenant_id, 1) = ? AND is_active = 1
                         AND deleted_at IS NULL LIMIT 1`, [userId || String(email || '').toLowerCase(), tid]);
  if (!u || !STAFF_ROLES.includes(u.role)) return null;
  return { id: u.id, name: u.full_name || u.username || u.email, email: u.email };
}

// ── Crear ───────────────────────────────────────────────────────────────────
/**
 * @param {object} p
 *  tenantId, kind ('incident'|'requirement'), summary, description, reporter (email o nombre),
 *  phone, priority, category, tipo (requerimientos), channel ('portal'|'admin'|'chatbot'|'email'|'api'),
 *  actor { id, name }, assignTo { userId|email } (opcional), io
 */
async function create(p) {
  const tid = Number(p.tenantId) || 1;
  const kind = p.kind === 'requirement' ? 'requirement' : 'incident';
  const k = KINDS[kind];
  const summary = String(p.summary || '').trim();
  if (!summary) throw new TicketError('El asunto es obligatorio');
  const reporter = String(p.reporter || '').trim().toLowerCase().slice(0, 200) || 'desconocido';
  const priority = PRIORITIES.includes(p.priority) ? p.priority : 'P3';
  const hours = await slaHours(tid, priority);
  const description = String(p.description || '').trim().slice(0, 20000) || summary;
  // Numeración por empresa: TK-<CÓDIGO>-0001 (la empresa sin código usa TK-0001)
  const key = await nextLocalTicketKey(await localKeyPrefix(k.prefix, tid));

  if (kind === 'incident') {
    await q(`INSERT INTO jira_tickets
               (ticket_key, summary, description, reporter, phone, component, status, internal_status,
                priority, sla_deadline, tenant_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'Abierto', 'abierto', ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, NOW())`,
      [key, summary.slice(0, 500), description, reporter, (p.phone || '-').slice(0, 50), (p.category || 'General').slice(0, 200),
       priority, hours, tid]);
  } else {
    await q(`INSERT INTO jira_requirements
               (req_key, summary, description, reporter, tipo, priority, status, internal_status, phone, sla_deadline, tenant_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'Abierto', 'abierto', ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, NOW())`,
      [key, summary.slice(0, 500), description, reporter, (p.tipo || p.category || null), priority, (p.phone || null), hours, tid]);
  }
  const channel = p.channel || 'portal';
  await history(key, p.actor, 'creacion', `${k.label[0].toUpperCase() + k.label.slice(1)} ${key} creada vía ${channel}${p.actor?.name ? ' por ' + p.actor.name : ''}`);
  emit(p.io, tid, 'ticket:created', { key, summary, priority, reporter, source: channel, kind });

  const cfg = await automation(tid);
  if (cfg.notify_reporter !== '0') {
    await notify(reporter, `[${key}] Recibimos tu ${k.label}: ${summary}`, {
      title: `📨 Registramos tu ${k.label}`, intro: 'Te avisaremos por este medio cuando haya novedades.',
      key, summary, fields: [['Prioridad', priority], ['Tiempo objetivo de solución', `${hours} horas`]],
      ctaUrl: appUrl() ? `${appUrl()}/autogestion` : null, ctaLabel: 'Ver mis tickets',
    });
  }

  // Asignación: la pedida explícitamente o el técnico por defecto de la empresa
  const target = p.assignTo || (kind === 'incident' && cfg.default_assignee_email ? { email: cfg.default_assignee_email } : null);
  if (target) {
    await assign({ tenantId: tid, key, ...target, actor: p.actor || { name: 'Sistema' }, io: p.io, quiet: !p.assignTo })
      .catch(e => logger.warn(`[local-tickets] asignación inicial ${key}: ${e.message}`));
  }
  return { key, kind, priority, slaHours: hours };
}

// ── Asignar ─────────────────────────────────────────────────────────────────
async function assign({ tenantId, key, userId, email, actor, io, quiet = false }) {
  const tid = Number(tenantId) || 1;
  const { row, k } = await load(tid, key);
  if (['resuelto', 'cerrado'].includes(row.internal_status)) throw new TicketError('No se puede asignar un ticket resuelto o cerrado');
  const tech = await staffUser(tid, { userId, email });
  if (!tech) throw new TicketError('El técnico no existe en esta empresa o no tiene rol de TI', 404);

  const nextStatus = ['abierto', 'asignado'].includes(row.internal_status) ? 'asignado' : row.internal_status;
  await q(`UPDATE ${k.table} /* tenant_id: validado en load() */ SET assigned_to = ?, assigned_to_name = ?, assigned_at = NOW(),
             internal_status = ?, status = ?, first_response_at = IFNULL(first_response_at, NOW())
           WHERE ${k.keyCol} = ?`, [tech.id, tech.name, nextStatus, STATUS_LABEL[nextStatus], key]);
  await history(key, actor, 'asignacion', actor?.id && String(actor.id) === String(tech.id)
    ? `Ticket tomado por ${tech.name}` : `Asignado a ${tech.name}${actor?.name ? ' por ' + actor.name : ''}`);
  emit(io, tid, 'ticket:updated', { key, assignedTo: tech.name, status: nextStatus });

  {
    // Al técnico siempre (salvo que se lo haya tomado él); al usuario, salvo asignación silenciosa
    if (!actor?.id || String(actor.id) !== String(tech.id)) {
      await notify(tech.email, `[${key}] Se te asignó: ${row.summary}`, {
        title: '🧑‍🔧 Tienes un ticket asignado', intro: `${actor?.name || 'El sistema'} te asignó este ticket.`,
        key, summary: row.summary, fields: [['Prioridad', row.priority], ['Solicitante', row.reporter],
          ['Vence', row.sla_deadline ? new Date(row.sla_deadline).toLocaleString('es-PE') : null]],
        note: row.description, noteLabel: 'Descripción',
        ctaUrl: appUrl() ? `${appUrl()}/incidencias?view=local` : null, ctaLabel: 'Abrir en gestión local',
      });
    }
    const cfg = await automation(tid);
    if (!quiet && cfg.notify_reporter !== '0') {
      await notify(row.reporter, `[${key}] Tu ticket está en atención`, {
        title: '👀 Tu ticket ya tiene responsable', intro: `${tech.name} está a cargo de tu solicitud.`,
        key, summary: row.summary,
      });
    }
  }
  return { key, assignedTo: tech };
}

// ── Cambiar estado ──────────────────────────────────────────────────────────
async function changeStatus({ tenantId, key, status, note, actor, io }) {
  const tid = Number(tenantId) || 1;
  const { row, k } = await load(tid, key);
  const from = row.internal_status || 'abierto';
  if (!STATUS_LABEL[status]) throw new TicketError('Estado inválido');
  if (from === status) return { key, status };
  if (!(TRANSITIONS[from] || []).includes(status))
    throw new TicketError(`No se puede pasar de "${STATUS_LABEL[from] || from}" a "${STATUS_LABEL[status]}"${['resuelto', 'cerrado'].includes(from) ? ' (usa Reabrir)' : ''}`);
  const cleanNote = String(note || '').trim();
  if (status === 'resuelto' && !cleanNote) throw new TicketError('Indica la solución aplicada para resolver el ticket');
  if (status === 'cerrado' && from !== 'resuelto' && !cleanNote) throw new TicketError('Indica el motivo del cierre');

  const sets = ['internal_status = ?', 'status = ?'];
  const vals = [status, STATUS_LABEL[status]];
  // SLA: se congela al esperar al usuario y se extiende lo que estuvo en pausa al reanudar
  if (status === 'pendiente_usuario') sets.push('sla_paused_at = IFNULL(sla_paused_at, NOW())');
  else if (row.sla_paused_at) sets.push('sla_deadline = DATE_ADD(sla_deadline, INTERVAL TIMESTAMPDIFF(SECOND, sla_paused_at, NOW()) SECOND)', 'sla_paused_at = NULL');
  if (status === 'resuelto') { sets.push('resolved_at = NOW()', 'resolution_note = ?'); vals.push(cleanNote.slice(0, 5000)); }
  if (status === 'cerrado') {
    sets.push('closed_at = NOW()', 'resolved_at = IFNULL(resolved_at, NOW())', 'closed_by = ?', 'close_comment = ?');
    vals.push((actor?.name || 'Sistema').slice(0, 200), (cleanNote || row.resolution_note || '').slice(0, 5000));
  }
  await q(`UPDATE ${k.table} /* tenant_id: validado en load() */ SET ${sets.join(', ')} WHERE ${k.keyCol} = ?`, [...vals, key]);
  await history(key, actor, 'cambio_estado', `Estado: ${STATUS_LABEL[from] || from} → ${STATUS_LABEL[status]}${actor?.name ? ' por ' + actor.name : ''}${cleanNote ? '. ' + cleanNote : ''}`);
  emit(io, tid, 'ticket:updated', { key, status });

  const cfg = await automation(tid);
  if (cfg.notify_reporter !== '0') {
    if (status === 'resuelto') {
      let surveyUrl = null;
      if (cfg.satisfaction_enabled === '1' && isEmail(row.reporter) && appUrl()) {
        const token = crypto.randomBytes(24).toString('hex');
        await q('INSERT INTO itsm_surveys (ticket_key, token, reporter_email, tenant_id) VALUES (?,?,?,?)', [key, token, row.reporter, tid]).catch(() => {});
        surveyUrl = `${appUrl()}/api/jira/survey-page/${token}`;
      }
      await notify(row.reporter, `[${key}] Resolvimos tu ticket: ${row.summary}`, {
        title: '✅ Ticket resuelto', intro: 'Si el problema continúa, responde a este correo y lo reabriremos.',
        key, summary: row.summary, note: cleanNote, noteLabel: 'Solución', surveyUrl,
      });
    } else if (status === 'pendiente_usuario') {
      await notify(row.reporter, `[${key}] Necesitamos tu respuesta`, {
        title: '⏸️ Esperamos tu respuesta', intro: 'Para continuar necesitamos información de tu parte. Responde a este correo.',
        key, summary: row.summary, note: cleanNote, noteLabel: 'Mensaje del técnico',
      });
    }
  }
  return { key, status };
}

// ── Reabrir ─────────────────────────────────────────────────────────────────
async function reopen({ tenantId, key, reason, actor, io }) {
  const tid = Number(tenantId) || 1;
  const { row, k } = await load(tid, key);
  if (!['resuelto', 'cerrado'].includes(row.internal_status)) throw new TicketError('Solo se reabren tickets resueltos o cerrados');
  if (!String(reason || '').trim()) throw new TicketError('Indica el motivo de la reapertura');
  const hours = await slaHours(tid, row.priority);
  await q(`UPDATE ${k.table} /* tenant_id: validado en load() */ SET internal_status = 'abierto', status = 'Abierto', assigned_to = NULL,
             assigned_to_name = NULL, assigned_at = NULL, resolved_at = NULL, closed_at = NULL, sla_paused_at = NULL,
             sla_deadline = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE ${k.keyCol} = ?`, [hours, key]);
  await history(key, actor, 'reapertura', `Reabierto${actor?.name ? ' por ' + actor.name : ''}. Motivo: ${String(reason).trim()}`);
  emit(io, tid, 'ticket:updated', { key, status: 'abierto' });
  return { key, status: 'abierto' };
}

// ── Comentario ──────────────────────────────────────────────────────────────
// internal = nota solo para TI. Un comentario público de un técnico se envía al usuario;
// uno del usuario (portal/correo) sobre un ticket en pausa lo reanuda.
async function comment({ tenantId, key, text, internal = false, actor, fromReporter = false, io }) {
  const tid = Number(tenantId) || 1;
  const { row, k } = await load(tid, key);
  const body = String(text || '').trim();
  if (!body) throw new TicketError('Comentario vacío');
  await q(`INSERT INTO ticket_comments /* tenant_id: validado en load() */ (ticket_id, user_id, contenido, tipo, created_at)
           VALUES (?, ?, ?, ?, NOW())`, [key, actor?.id || 0, body.slice(0, 15000), internal ? 'interno' : 'comentario']);
  if (!internal && !fromReporter && actor?.id) {
    await q(`UPDATE ${k.table} /* tenant_id: validado en load() */ SET first_response_at = IFNULL(first_response_at, NOW()) WHERE ${k.keyCol} = ?`, [key]);
    const cfg = await automation(tid);
    if (cfg.notify_reporter !== '0') {
      await notify(row.reporter, `[${key}] Nuevo mensaje sobre tu ticket`, {
        title: '💬 Tienes una respuesta', intro: `${actor.name || 'El equipo de TI'} escribió en tu ticket.`,
        key, summary: row.summary, note: body, noteLabel: 'Mensaje',
      });
    }
  }
  if (fromReporter && row.internal_status === 'pendiente_usuario') {
    await changeStatus({ tenantId: tid, key, status: row.assigned_to ? 'en_progreso' : 'abierto', actor: { name: 'Sistema' }, io })
      .catch(() => {});
  }
  emit(io, tid, 'ticket:comment', { key, internal });
  return { key };
}

// ── Cierre automático ───────────────────────────────────────────────────────
// Resueltos sin respuesta del usuario por N días (automatización auto_close_days,
// por defecto 3; 0 = desactivado) pasan a cerrado.
async function autoCloseAll() {
  const tenants = await q('SELECT id FROM tenants WHERE is_active = 1');
  let total = 0;
  for (const { id } of tenants) {
    const cfg = await automation(id);
    const days = cfg.auto_close_days === undefined || cfg.auto_close_days === '' ? 3 : parseInt(cfg.auto_close_days, 10);
    if (!(days > 0)) continue;
    for (const k of Object.values(KINDS)) {
      const rows = await q(`SELECT ${k.keyCol} AS \`key\` FROM ${k.table}
                            WHERE COALESCE(tenant_id, 1) = ? AND internal_status = 'resuelto' AND ${k.keyCol} LIKE ?
                              AND resolved_at < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 200`, [id, `${k.prefix}-%`, days]);
      for (const r of rows) {
        await changeStatus({ tenantId: id, key: r.key, status: 'cerrado', note: `Cierre automático: ${days} día(s) sin respuesta tras la resolución`, actor: { name: 'Sistema' } })
          .then(() => total++).catch(() => {});
      }
    }
  }
  return total;
}

module.exports = {
  create, assign, changeStatus, reopen, comment, autoCloseAll, load,
  TicketError, STATUS_LABEL, TRANSITIONS, kindOfKey,
};

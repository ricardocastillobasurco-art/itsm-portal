'use strict';

// Correo a ticket: convierte cada correo recibido en el buzón de soporte de un
// tenant en una incidencia local (TK-XXXX) o, si el asunto trae la clave de un
// ticket existente del tenant ("[TK-0123]"), en un comentario de ese ticket.
//
// Independiente del proveedor: los proveedores (graph / imap) entregan mensajes
// normalizados { messageId, from: { email, name }, subject, text, autoSubmitted,
// attachments: [{ filename, contentType, content: Buffer, inline }] }.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../../config/database');
const { nextLocalTicketKey, agentsRoom } = require('../../utils/tenantTickets');
const logger = require('../../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

const UPLOAD_DIR       = path.join(__dirname, '../../../uploads/tickets');
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS  = 10;
const MAX_PER_SENDER_H = 10;   // tickets nuevos por remitente y hora (anti-spam / anti-bucle)
const SLA_FALLBACK_H   = { P1: 1, P2: 4, P3: 8, P4: 24 };
const KEY_RE           = /\[?\b((?:TK|INC|REQ)-\d{3,})\b\]?/i;
const URGENT_RE        = /\b(urgente|urgent|cr[ií]tico|ca[ií]do|no funciona nada)\b/i;
const NOREPLY_RE       = /(no-?reply|mailer-daemon|postmaster|bounce)/i;
const AUTO_SUBJECT_RE  = /^(automatic reply|respuesta autom[aá]tica|auto:|out of office|fuera de la oficina|undeliverable|no se puede entregar|delivery status notification)/i;

// ── Configuración del tenant ────────────────────────────────────────────────
// config: { provider, mailbox, imap_host, imap_port, imap_user, imap_pass,
//           allowed_domains ("*" = cualquiera; vacío = dominio del tenant), default_priority }
function allowedDomains(cfg, tenant) {
  const raw = String(cfg.allowed_domains || '').trim();
  if (raw === '*') return null; // sin restricción
  const list = raw ? raw.split(/[,;\s]+/) : [tenant.domain];
  return list.map(d => String(d || '').trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

function ignoreReason(msg, cfg, tenant) {
  const from = (msg.from?.email || '').toLowerCase();
  if (!from || !from.includes('@'))                           return 'sin remitente';
  if (cfg.mailbox && from === String(cfg.mailbox).toLowerCase()) return 'enviado por el propio buzón';
  if (msg.autoSubmitted)                                      return 'respuesta automática';
  if (NOREPLY_RE.test(from))                                  return 'remitente automático';
  if (AUTO_SUBJECT_RE.test((msg.subject || '').trim()))       return 'respuesta automática';
  const domains = allowedDomains(cfg, tenant);
  if (domains && !domains.includes(from.split('@')[1]))       return 'dominio no autorizado';
  return null;
}

// Quita la parte citada de una respuesta ("El ... escribió:", "-----Original Message-----", etc.)
function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(l =>
    /^\s*>/.test(l) ||
    /^-{2,}\s*(original message|mensaje original)/i.test(l) ||
    /^\s*(on .+ wrote:|el .+ escribi[oó]:)\s*$/i.test(l) ||
    /^\s*(from|de):\s.+@/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

async function alreadyProcessed(tid, messageId) {
  const [r] = await q('SELECT id FROM email_ticket_log WHERE tenant_id = ? AND message_id = ? LIMIT 1', [tid, messageId]);
  return !!r;
}

async function log(tid, msg, action, ticketKey = null, reason = null) {
  await q(`INSERT IGNORE INTO email_ticket_log (tenant_id, message_id, from_email, subject, action, ticket_key, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tid, msg.messageId, (msg.from?.email || '').slice(0, 255), (msg.subject || '').slice(0, 500), action, ticketKey, reason]);
}

async function saveAttachments(ticketKey, msg) {
  const files = (msg.attachments || [])
    .filter(a => a.content && a.content.length <= MAX_ATTACH_BYTES)
    // Omite imágenes pequeñas incrustadas (firmas, logos)
    .filter(a => !(a.inline && /^image\//.test(a.contentType || '') && a.content.length < 20 * 1024))
    .slice(0, MAX_ATTACHMENTS);
  if (!files.length) return 0;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const a of files) {
    const original = String(a.filename || 'adjunto').replace(/[\\/]/g, '_').slice(0, 200);
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(original).slice(0, 10)}`;
    const full = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(full, a.content);
    await q(`INSERT INTO ticket_attachments /* tenant_id: ticket padre recién validado */
               (ticket_id, user_id, filename, original, originalname, mimetype, size_bytes, size, path)
             VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketKey, filename, original, original, a.contentType || 'application/octet-stream', a.content.length, a.content.length, full]);
  }
  return files.length;
}

async function slaHours(tid, priority) {
  try {
    const { SLAPolicy } = require('../../models');
    const p = await SLAPolicy.forTenant(tid, priority);
    if (p?.tiempoResolucionH) return Number(p.tiempoResolucionH);
  } catch (_) {}
  return SLA_FALLBACK_H[priority] || 8;
}

async function addComment(tid, ticketKey, msg, io) {
  const body = stripQuoted(msg.text) || '(correo sin texto)';
  const from = msg.from.email.toLowerCase();
  await q(`INSERT INTO ticket_comments /* tenant_id: ticket validado en el tenant */ (ticket_id, user_id, contenido, tipo, created_at)
           VALUES (?, 0, ?, 'comentario', NOW())`, [ticketKey, `✉️ ${from}:\n${body}`.slice(0, 15000)]);
  await q(`INSERT INTO ticket_history /* tenant_id: ticket validado en el tenant */ (ticket_id, user_id, user_name, evento, detalle)
           VALUES (?, 0, ?, 'comentario', ?)`, [ticketKey, from, `Respuesta por correo de ${from}`]).catch(() => {});
  const n = await saveAttachments(ticketKey, msg);
  if (io) io.to(agentsRoom(tid)).emit('ticket:comment', { key: ticketKey, from, attachments: n });
}

async function createTicket(tid, cfg, msg, io) {
  const subject  = (msg.subject || '').trim() || '(sin asunto)';
  const text     = String(msg.text || '').trim();
  const priority = URGENT_RE.test(`${subject} ${text.slice(0, 500)}`) ? 'P2'
                 : (['P1', 'P2', 'P3', 'P4'].includes(cfg.default_priority) ? cfg.default_priority : 'P3');
  const from     = msg.from.email.toLowerCase();
  const key      = await nextLocalTicketKey('TK');
  const hours    = await slaHours(tid, priority);

  await q(`INSERT INTO jira_tickets
             (ticket_key, summary, description, reporter, status, internal_status, priority, sla_deadline, tenant_id, created_at)
           VALUES (?, ?, ?, ?, 'Abierto', 'abierto', ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, NOW())`,
    [key, subject.slice(0, 500), text.slice(0, 20000), from, priority, hours, tid]);
  await q(`INSERT INTO ticket_history /* tenant_id: ticket recién creado por este tenant */ (ticket_id, user_id, user_name, evento, detalle)
           VALUES (?, 0, ?, 'creacion', ?)`, [key, from, `Ticket ${key} creado desde correo de ${from}`]).catch(() => {});
  await saveAttachments(key, msg);

  if (io) io.to(agentsRoom(tid)).emit('ticket:created', { key, summary: subject, priority, reporter: from, source: 'email' });

  // Acuse de recibo: el asunto lleva la clave para que las respuestas se agreguen al ticket
  try {
    const { enqueueEmail } = require('../../queues/index');
    await enqueueEmail({
      to: from,
      subject: `[${key}] Recibimos tu solicitud: ${subject}`.slice(0, 250),
      template: 'ticket-recibido-correo',
      vars: { key, subject, priority, hours },
    });
  } catch (e) { logger.warn(`[email-to-ticket] acuse de recibo no enviado (${key}): ${e.message}`); }
  return key;
}

/**
 * Procesa un mensaje normalizado para un tenant.
 * Devuelve { action: 'created'|'comment'|'ignored'|'duplicate', ticketKey?, reason? }.
 */
async function processMessage(tenant, cfg, msg, { io = null } = {}) {
  const tid = Number(tenant.id);
  if (!msg.messageId) msg.messageId = crypto.createHash('sha256')
    .update(`${msg.from?.email}|${msg.subject}|${msg.date || ''}|${String(msg.text || '').slice(0, 200)}`).digest('hex');
  if (await alreadyProcessed(tid, msg.messageId)) return { action: 'duplicate' };

  const reason = ignoreReason(msg, cfg, tenant);
  if (reason) { await log(tid, msg, 'ignored', null, reason); return { action: 'ignored', reason }; }

  try {
    // ¿Respuesta a un ticket existente de ESTE tenant?
    const m = (msg.subject || '').match(KEY_RE);
    if (m) {
      const [t] = await q('SELECT ticket_key FROM jira_tickets WHERE ticket_key = ? AND COALESCE(tenant_id, 1) = ? LIMIT 1',
        [m[1].toUpperCase(), tid]);
      if (t) {
        await addComment(tid, t.ticket_key, msg, io);
        await log(tid, msg, 'comment', t.ticket_key);
        return { action: 'comment', ticketKey: t.ticket_key };
      }
    }

    const [cnt] = await q(`SELECT COUNT(*) AS n FROM email_ticket_log
                           WHERE tenant_id = ? AND from_email = ? AND action = 'created' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [tid, msg.from.email.toLowerCase()]);
    if (Number(cnt.n) >= MAX_PER_SENDER_H) {
      await log(tid, msg, 'ignored', null, 'límite de tickets por hora del remitente');
      return { action: 'ignored', reason: 'límite por hora' };
    }

    const key = await createTicket(tid, cfg, msg, io);
    await log(tid, msg, 'created', key);
    return { action: 'created', ticketKey: key };
  } catch (e) {
    logger.error(`[email-to-ticket] tenant ${tid}: ${e.message}`);
    await log(tid, msg, 'error', null, e.message.slice(0, 255)).catch(() => {});
    return { action: 'error', reason: e.message };
  }
}

module.exports = { processMessage, stripQuoted, ignoreReason, allowedDomains, KEY_RE };

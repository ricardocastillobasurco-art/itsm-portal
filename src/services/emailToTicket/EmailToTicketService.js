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
const logger = require('../../utils/logger');
const LocalTickets = require('../localTickets/LocalTicketService');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

const UPLOAD_DIR       = path.join(__dirname, '../../../uploads/tickets');
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS  = 10;
const MAX_PER_SENDER_H = 10;   // tickets nuevos por remitente y hora (anti-spam / anti-bucle)
const KEY_RE           = /\[?\b((?:TK|RQ|INC|REQ)-\d{3,})\b\]?/i;
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

// Comentario y alta pasan por el motor local: mismas reglas, SLA y avisos que el resto de canales
async function addComment(tid, ticketKey, msg, io) {
  const body = stripQuoted(msg.text) || '(correo sin texto)';
  const from = msg.from.email.toLowerCase();
  await LocalTickets.comment({ tenantId: tid, key: ticketKey, text: `✉️ ${from}:\n${body}`, fromReporter: true,
    actor: { name: from }, io });
  await saveAttachments(ticketKey, msg);
}

async function createTicket(tid, cfg, msg, io) {
  const subject  = (msg.subject || '').trim() || '(sin asunto)';
  const text     = String(msg.text || '').trim();
  const priority = URGENT_RE.test(`${subject} ${text.slice(0, 500)}`) ? 'P2'
                 : (['P1', 'P2', 'P3', 'P4'].includes(cfg.default_priority) ? cfg.default_priority : 'P3');
  const from     = msg.from.email.toLowerCase();
  // El motor registra, aplica SLA de la empresa, asigna por defecto y envía el acuse al remitente
  const { key } = await LocalTickets.create({ tenantId: tid, kind: 'incident', summary: subject, description: text,
    priority, reporter: from, channel: 'correo', actor: { name: from }, io });
  await saveAttachments(key, msg);
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
      const [t] = await q(`SELECT ticket_key FROM jira_tickets WHERE ticket_key = ? AND COALESCE(tenant_id, 1) = ?
                           UNION ALL SELECT req_key FROM jira_requirements WHERE req_key = ? AND COALESCE(tenant_id, 1) = ? LIMIT 1`,
        [m[1].toUpperCase(), tid, m[1].toUpperCase(), tid]);
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

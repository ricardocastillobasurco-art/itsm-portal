'use strict';

// Proveedor Microsoft 365 (Graph): lee los correos no leídos de la bandeja de
// entrada del buzón de soporte y los marca como leídos tras procesarlos.
// Permiso de aplicación requerido en Azure: Mail.ReadWrite (sobre ese buzón).

const axios = require('axios');
const GraphService = require('../../integrations/GraphService');

const BATCH = 25;

function client(tenant, cfg) {
  const graph = GraphService.fromTenant(tenant);
  if (cfg.mailbox) graph.mailbox = cfg.mailbox;
  if (!graph.isConfigured()) throw new Error('Microsoft 365 no configurado para esta empresa (credenciales de la app Azure y buzón)');
  return graph;
}

async function fetchUnread(tenant, cfg) {
  const graph = client(tenant, cfg);
  const token = await graph.getToken();
  const mb = encodeURIComponent(graph.mailbox);
  const api = axios.create({
    baseURL: `https://graph.microsoft.com/v1.0/users/${mb}`,
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
    timeout: 30000,
  });

  const { data } = await api.get('/mailFolders/inbox/messages', {
    params: {
      $filter: 'isRead eq false',
      $top: BATCH,
      $select: 'id,subject,from,receivedDateTime,internetMessageId,body,hasAttachments,internetMessageHeaders',
    },
  });
  const items = (data.value || []).sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));

  const messages = [];
  for (const m of items) {
    const headers = Object.fromEntries((m.internetMessageHeaders || []).map(h => [String(h.name).toLowerCase(), h.value]));
    let attachments = [];
    if (m.hasAttachments) {
      const r = await api.get(`/messages/${m.id}/attachments`).catch(() => ({ data: { value: [] } }));
      attachments = (r.data.value || [])
        .filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
        .map(a => ({ filename: a.name, contentType: a.contentType, inline: !!a.isInline, content: Buffer.from(a.contentBytes, 'base64') }));
    }
    messages.push({
      messageId: m.internetMessageId || m.id,
      date: m.receivedDateTime,
      from: { email: m.from?.emailAddress?.address || '', name: m.from?.emailAddress?.name || '' },
      subject: m.subject || '',
      text: m.body?.content || '',
      autoSubmitted: !!headers['auto-submitted'] && headers['auto-submitted'] !== 'no',
      attachments,
      _ack: () => api.patch(`/messages/${m.id}`, { isRead: true }),
    });
  }
  return messages;
}

// Prueba de conexión: cuántos no leídos hay (no marca nada)
async function test(tenant, cfg) {
  const graph = client(tenant, cfg);
  const token = await graph.getToken();
  const { data } = await axios.get(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graph.mailbox)}/mailFolders/inbox`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
  return { mailbox: graph.mailbox, unread: data.unreadItemCount ?? null };
}

module.exports = { fetchUnread, test };

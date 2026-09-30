'use strict';

// Proveedor IMAP (Gmail con contraseña de aplicación, Zoho, cPanel, etc.): lee los
// correos no leídos de INBOX y los marca como leídos (\Seen) tras procesarlos.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const BATCH = 25;

function connect(cfg) {
  if (!cfg.imap_host || !cfg.imap_user || !cfg.imap_pass) throw new Error('IMAP incompleto: servidor, usuario y contraseña son obligatorios');
  const port = Number(cfg.imap_port) || 993;
  return new ImapFlow({
    host: cfg.imap_host, port, secure: port === 993,
    auth: { user: cfg.imap_user, pass: cfg.imap_pass },
    logger: false, socketTimeout: 60000,
  });
}

// Devuelve los mensajes y una función close(); cada mensaje trae _ack() para marcarlo leído
async function fetchUnread(tenant, cfg) {
  const imap = connect(cfg);
  await imap.connect();
  const lock = await imap.getMailboxLock('INBOX');
  const messages = [];
  try {
    const uids = (await imap.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids.slice(0, BATCH)) {
      const { content } = await imap.download(String(uid), undefined, { uid: true });
      const parsed = await simpleParser(content);
      const auto = parsed.headers.get('auto-submitted');
      messages.push({
        messageId: parsed.messageId || `imap-${cfg.imap_user}-${uid}`,
        date: parsed.date,
        from: { email: parsed.from?.value?.[0]?.address || '', name: parsed.from?.value?.[0]?.name || '' },
        subject: parsed.subject || '',
        text: parsed.text || '',
        autoSubmitted: !!auto && String(auto).toLowerCase() !== 'no',
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename, contentType: a.contentType, inline: a.contentDisposition === 'inline', content: a.content,
        })),
        _ack: () => imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }),
      });
    }
  } catch (e) {
    lock.release(); await imap.logout().catch(() => {});
    throw e;
  }
  return { messages, close: async () => { lock.release(); await imap.logout().catch(() => {}); } };
}

async function test(tenant, cfg) {
  const imap = connect(cfg);
  await imap.connect();
  try {
    const st = await imap.status('INBOX', { unseen: true });
    return { mailbox: cfg.imap_user, unread: st.unseen ?? null };
  } finally { await imap.logout().catch(() => {}); }
}

module.exports = { fetchUnread, test };

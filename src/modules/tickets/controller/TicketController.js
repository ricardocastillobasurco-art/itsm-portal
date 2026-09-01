'use strict';

const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const TicketService = require('../service/TicketService');

// ── Multer config ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../../../uploads/tickets');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const _storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage: _storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Factory: instancia TicketService con el tenantId del request ──────────────
function svc(req) {
  return new TicketService(req.tenant.id);
}

function ctx(req) {
  return {
    correlationId: req.correlationId,
    userEmail:     req.user?.email,
    userName:      req.user?.nombre || req.user?.name,
    ip:            req.ip || req.headers['x-forwarded-for'],
    userAgent:     req.headers['user-agent'],
  };
}

function pCtx(req) {
  return { user: req.user, tenant: req.tenant };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const { count, rows } = await svc(req).list(req.query);
    res.paginated(rows, count, req.query.page || 1, req.query.limit || 25);
  } catch (err) { next(err); }
}

async function kpis(req, res, next) {
  try {
    res.ok(await svc(req).getKPIs());
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    res.ok(await svc(req).getById(req.params.id, pCtx(req)));
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const ticket = await svc(req).create({ ...req.body, userId: req.user?.id }, ctx(req), pCtx(req));
    res.ok(ticket, 'Ticket creado', 201);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const ticket = await svc(req).update(req.params.id, req.body, req.user?.id, ctx(req), pCtx(req));
    res.ok(ticket);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await svc(req).softDelete(req.params.id, pCtx(req));
    const { bus } = require('../../../core/events');
    await bus.emit('ticket.deleted', { ticketId: req.params.id, tenantId: req.tenant.id, userId: req.user?.id, correlationId: req.correlationId });
    res.ok(null, 'Ticket eliminado');
  } catch (err) { next(err); }
}

async function addComment(req, res, next) {
  try {
    const comment = await svc(req).addComment(req.params.id, req.body, req.user?.id, pCtx(req));
    res.ok(comment, 'Comentario añadido', 201);
  } catch (err) { next(err); }
}

async function addAttachment(req, res, next) {
  try {
    const att = await svc(req).addAttachment(req.params.id, req.file, req.user?.id);
    res.ok(att, 'Adjunto subido', 201);
  } catch (err) { next(err); }
}

async function categories(req, res, next) {
  try {
    res.ok(await svc(req).getCategories());
  } catch (err) { next(err); }
}

module.exports = { list, kpis, getOne, create, update, remove, addComment, addAttachment, categories, upload };

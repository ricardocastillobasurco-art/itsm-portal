'use strict';

const svc = require('../service/KnowledgeService');
const { tenantId } = require('../../../utils/tenantScope');

async function categories(req, res, next) {
  try { res.ok(await svc.getCategories(tenantId(req))); } catch (e) { next(e); }
}

async function list(req, res, next) {
  try {
    const { count, rows } = await svc.list({ ...req.query, tenantId: tenantId(req) });
    res.paginated(rows, count, req.query.page || 1, req.query.limit || 20);
  } catch (e) { next(e); }
}

async function search(req, res, next) {
  try { res.ok(await svc.search(req.query.q, req.query.limit, req.user.id, tenantId(req))); } catch (e) { next(e); }
}

async function suggest(req, res, next) {
  try { res.ok(await svc.suggest(req.query.q, tenantId(req))); } catch (e) { next(e); }
}

async function popular(req, res, next) {
  try { res.ok(await svc.popular(tenantId(req))); } catch (e) { next(e); }
}

async function noResults(req, res, next) {
  try { res.ok(await svc.noResults(tenantId(req))); } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try { res.ok(await svc.getById(req.params.id, tenantId(req))); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const article = await svc.create({ ...req.body, authorId: req.user.id }, tenantId(req));
    res.ok(article, 'Artículo creado', 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.ok(await svc.update(req.params.id, req.body, tenantId(req))); } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try { await svc.remove(req.params.id, tenantId(req)); res.ok(null, 'Artículo eliminado'); } catch (e) { next(e); }
}

async function vote(req, res, next) {
  try { await svc.vote(req.params.id, req.body.vote, tenantId(req)); res.ok(null); } catch (e) { next(e); }
}

async function linkTicket(req, res, next) {
  try { await svc.linkTicket(req.params.id, req.body.ticketId, req.user.id, tenantId(req)); res.ok(null); } catch (e) { next(e); }
}

// ── Procedimientos ────────────────────────────────────────────────────────────

async function getProcedures(req, res, next) {
  try { res.ok(await svc.getProcedures(req.query.category, tenantId(req))); } catch (e) { next(e); }
}

async function getProcedureById(req, res, next) {
  try { res.ok(await svc.getProcedureById(req.params.id, tenantId(req))); } catch (e) { next(e); }
}

async function createProcedure(req, res, next) {
  try { await svc.createProcedure(req.body, req.user, tenantId(req)); res.ok(null, 'Procedimiento creado', 201); } catch (e) { next(e); }
}

async function deactivateProcedure(req, res, next) {
  try { await svc.deactivateProcedure(req.params.id, req.user, tenantId(req)); res.ok(null); } catch (e) { next(e); }
}

// ── Solicitudes de procedimiento ──────────────────────────────────────────────

async function getProcedureRequests(req, res, next) {
  try { res.ok(await svc.getProcedureRequests(req.user, tenantId(req))); } catch (e) { next(e); }
}

async function createProcedureRequest(req, res, next) {
  try {
    await svc.createProcedureRequest(req.body, req.user, req.body, tenantId(req));
    res.ok(null, 'Solicitud enviada correctamente');
  } catch (e) { next(e); }
}

async function updateProcedureRequestStatus(req, res, next) {
  try {
    await svc.updateProcedureRequestStatus(req.params.id, req.body.status, req.user, tenantId(req));
    res.ok(null);
  } catch (e) { next(e); }
}

module.exports = {
  categories, list, search, suggest, popular, noResults,
  getOne, create, update, remove, vote, linkTicket,
  getProcedures, getProcedureById, createProcedure, deactivateProcedure,
  getProcedureRequests, createProcedureRequest, updateProcedureRequestStatus,
};

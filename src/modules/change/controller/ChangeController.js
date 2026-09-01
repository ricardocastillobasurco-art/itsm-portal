'use strict';

const ChangeService = require('../service/ChangeService');

function svc(req)  { return new ChangeService(req.tenant.id); }
function pCtx(req) { return { user: req.user, tenant: req.tenant }; }

async function list(req, res, next) {
  try {
    const { count, rows } = await svc(req).list(req.query);
    res.paginated(rows, count, req.query.page || 1, req.query.limit || 20);
  } catch (e) { next(e); }
}

async function kpis(req, res, next) {
  try { res.ok(await svc(req).getKPIs()); } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try { res.ok(await svc(req).getById(req.params.id, pCtx(req))); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const ch = await svc(req).create({ ...req.body, requestedBy: req.user?.id }, pCtx(req));
    res.ok(ch, 'Cambio registrado', 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.ok(await svc(req).update(req.params.id, req.body, pCtx(req))); } catch (e) { next(e); }
}

async function submitForApproval(req, res, next) {
  try { res.ok(await svc(req).submitForApproval(req.params.id, pCtx(req)), 'Cambio enviado a aprobación'); } catch (e) { next(e); }
}

async function approve(req, res, next) {
  try {
    const ch = await svc(req).approve(req.params.id, {
      approvalFlowId: req.body.approvalFlowId,
      decision:       req.body.decision,
      comments:       req.body.comments,
      approverId:     req.user?.id,
    }, pCtx(req));
    res.ok(ch);
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try { await svc(req).remove(req.params.id, pCtx(req)); res.ok(null, 'Cambio eliminado'); } catch (e) { next(e); }
}

module.exports = { list, kpis, getOne, create, update, submitForApproval, approve, remove };

'use strict';

const CmdbService = require('../service/CmdbService');

function svc(req)  { return new CmdbService(req.tenant.id); }
function pCtx(req) { return { user: req.user, tenant: req.tenant }; }

async function types(req, res, next) {
  try { res.ok(await svc(req).getTypes()); } catch (e) { next(e); }
}

async function kpis(req, res, next) {
  try { res.ok(await svc(req).getKPIs()); } catch (e) { next(e); }
}

async function list(req, res, next) {
  try {
    const { count, rows } = await svc(req).list(req.query);
    res.paginated(rows, count, req.query.page || 1, req.query.limit || 25);
  } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try {
    const { ci, relationships } = await svc(req).getById(req.params.id, pCtx(req));
    res.ok({ ...ci.toJSON(), relationships });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const ci = await svc(req).create({ ...req.body, ownerId: req.user?.id }, pCtx(req));
    res.ok(ci, 'CI creado', 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.ok(await svc(req).update(req.params.id, req.body, pCtx(req))); } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try { await svc(req).remove(req.params.id, pCtx(req)); res.ok(null, 'CI eliminado'); } catch (e) { next(e); }
}

async function addRelationship(req, res, next) {
  try {
    const rel = await svc(req).addRelationship(req.params.id, req.body.targetId, req.body.relationship, pCtx(req));
    res.ok(rel, 'Relación creada', 201);
  } catch (e) { next(e); }
}

async function removeRelationship(req, res, next) {
  try { await svc(req).removeRelationship(req.params.relId); res.ok(null, 'Relación eliminada'); } catch (e) { next(e); }
}

module.exports = { types, kpis, list, getOne, create, update, remove, addRelationship, removeRelationship };

'use strict';

const svc = require('../service/ProblemService');

async function list(req, res, next) {
  try {
    const { count, rows } = await svc.list(req.query);
    res.paginated(rows, count, req.query.page || 1, req.query.limit || 20);
  } catch (e) { next(e); }
}

async function kpis(req, res, next) {
  try { res.ok(await svc.getKPIs()); } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try { res.ok(await svc.getById(req.params.id)); } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const p = await svc.create({ ...req.body, assignedTo: req.user.id });
    res.ok(p, 'Problema registrado', 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try { res.ok(await svc.update(req.params.id, req.body)); } catch (e) { next(e); }
}

async function addKnownError(req, res, next) {
  try {
    const ke = await svc.addKnownError(req.params.id, req.body);
    res.ok(ke, 'Error conocido registrado', 201);
  } catch (e) { next(e); }
}

module.exports = { list, kpis, getOne, create, update, addKnownError };

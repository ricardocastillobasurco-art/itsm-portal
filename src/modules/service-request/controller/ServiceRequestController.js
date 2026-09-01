'use strict';

const ServiceRequestService = require('../service/ServiceRequestService');
const { logAudit } = require('../../../utils/audit');

const STAFF_ROLES = ['administrador', 'especialista', 'agente', 'tecnico'];

function svc(req) {
  return new ServiceRequestService(req.tenant.id);
}

async function list(req, res, next) {
  try {
    const { status, priority, page, limit, mine } = req.query;
    const result = await svc(req).findAll({ status, priority, page, limit, mine, userId: req.user.id, role: req.user.role });
    res.paginated(result.rows, result.count, result.page, limit || 20);
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    res.ok(await svc(req).findById(req.params.id));
  } catch (err) { next(err); }
}

async function catalog(req, res, next) {
  try {
    res.ok(await svc(req).getCatalog());
  } catch (err) { next(err); }
}

async function software(req, res, next) {
  try {
    res.ok(await svc(req).findSoftware(req.query.q));
  } catch (err) { next(err); }
}

async function createSoftware(req, res, next) {
  try {
    if (!STAFF_ROLES.includes(req.user?.role)) return res.fail('Sin permiso', 403, 'FORBIDDEN');
    const id = await svc(req).createSoftware(req.body);
    res.ok({ id }, 'Software registrado', 201);
  } catch (err) { next(err); }
}

async function removeSoftware(req, res, next) {
  try {
    if (!STAFF_ROLES.includes(req.user?.role)) return res.fail('Sin permiso', 403, 'FORBIDDEN');
    await svc(req).deactivateSoftware(req.params.id);
    res.ok(null, 'Software desactivado');
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const sr = await svc(req).create({ ...req.body, requesterId: req.user.id, userEmail: req.user.email });
    await logAudit(req, 'create_service_request', 'service_requests', sr.id, { title: sr.title });
    res.ok(sr, 'Solicitud creada', 201);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const sr = await svc(req).update(req.params.id, req.body);
    await logAudit(req, 'update_service_request', 'service_requests', req.params.id, req.body);
    res.ok(sr);
  } catch (err) { next(err); }
}

async function approve(req, res, next) {
  try {
    const sr = await svc(req).approve(req.params.id, { ...req.body, approverId: req.user.id });
    await logAudit(req, 'approve_service_request', 'service_requests', req.params.id, req.body);
    res.ok(sr);
  } catch (err) { next(err); }
}

async function notify(req, res, next) {
  try {
    const toEmail = await svc(req).notify(req.params.id, req.body, req.user);
    res.ok(null, `Correo enviado a ${toEmail}`);
  } catch (err) { next(err); }
}

module.exports = { list, getOne, catalog, software, createSoftware, removeSoftware, create, update, approve, notify };

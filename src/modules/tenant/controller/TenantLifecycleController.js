'use strict';

const svc       = require('../../../services/TenantLifecycleService');
const importSvc = require('../../../services/TenantImportService');

// ── Listar tenants ────────────────────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    res.ok(await svc.list({ includeInactive }));
  } catch (e) { next(e); }
}

// ── Suspender / reactivar ─────────────────────────────────────────────────────
async function setStatus(req, res, next) {
  try {
    const tenantId = parseInt(req.params.tenantId);
    const actorId  = req.user?.id;
    const { action, reason } = req.body;   // action: 'suspend' | 'reactivate'

    let tenant;
    if (action === 'suspend') {
      tenant = await svc.suspend(tenantId, actorId, reason || '');
    } else if (action === 'reactivate') {
      tenant = await svc.reactivate(tenantId, actorId);
    } else {
      return res.fail('action debe ser "suspend" o "reactivate"', 400);
    }
    res.ok(tenant);
  } catch (e) { next(e); }
}

// ── Cambiar plan ──────────────────────────────────────────────────────────────
async function changePlan(req, res, next) {
  try {
    const tenantId = parseInt(req.params.tenantId);
    const actorId  = req.user?.id;
    const { plan } = req.body;
    if (!plan) return res.fail('plan es requerido', 400);
    res.ok(await svc.changePlan(tenantId, plan, actorId));
  } catch (e) { next(e); }
}

// ── Exportar datos (GDPR) ─────────────────────────────────────────────────────
async function exportData(req, res, next) {
  try {
    const tenantId = parseInt(req.params.tenantId);
    const data     = await svc.exportData(tenantId);
    res.setHeader('Content-Disposition', `attachment; filename="tenant-${tenantId}-export.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data, null, 2));
  } catch (e) { next(e); }
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function auditLog(req, res, next) {
  try {
    const tenantId = parseInt(req.params.tenantId);
    const limit    = Math.min(parseInt(req.query.limit  || 50), 200);
    const offset   = parseInt(req.query.offset || 0);
    res.ok(await svc.getAuditLog(tenantId, { limit, offset }));
  } catch (e) { next(e); }
}

// ── Crear nuevo tenant ────────────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    const { name, slug, plan, domain, contactEmail, settings } = req.body;
    if (!name) return res.fail('name es requerido', 400);
    const tenant = await svc.create({ name, slug, plan, domain, contactEmail, settings }, req.user?.id);
    res.ok(tenant, 'Cliente creado exitosamente', 201);
  } catch (e) { next(e); }
}

// ── Listar con stats ──────────────────────────────────────────────────────────
async function listWithStats(req, res, next) {
  try {
    res.ok(await svc.listWithStats());
  } catch (e) { next(e); }
}

// ── Importar CSV por sección ──────────────────────────────────────────────────
async function importData(req, res, next) {
  try {
    const tenantId = parseInt(req.params.tenantId);
    const { section, rows } = req.body;
    if (!section)              return res.fail('section es requerido', 400);
    if (!Array.isArray(rows))  return res.fail('rows debe ser un array', 400);
    if (rows.length === 0)     return res.fail('No hay filas para importar', 400);
    if (rows.length > 5000)    return res.fail('Máximo 5000 filas por importación', 400);
    const result = await importSvc.importSection(tenantId, section, rows, req.user?.id);
    res.ok(result);
  } catch (e) { next(e); }
}

// ── Obtener secciones disponibles para import ─────────────────────────────────
async function getSections(req, res, next) {
  try {
    const sections = importSvc.getSections();
    res.ok(Object.entries(sections).map(([key, v]) => ({ key, label: v.label, required: v.required, optional: v.optional, template: v.template })));
  } catch (e) { next(e); }
}

// ── Exportar sección como CSV ─────────────────────────────────────────────────
async function exportCsv(req, res, next) {
  try {
    const tenantId = parseInt(req.params.tenantId);
    const section  = req.params.section;
    const { csv, filename } = await svc.exportSectionCsv(tenantId, section);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end('﻿' + csv); // BOM para que Excel abra con tildes correctamente
  } catch (e) { next(e); }
}

module.exports = { list, listWithStats, create, setStatus, changePlan, exportData, exportCsv, auditLog, importData, getSections };

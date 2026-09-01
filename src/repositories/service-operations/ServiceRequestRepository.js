'use strict';

const { v4: uuidv4 } = require('uuid');
const { ServiceRequest, ApprovalFlow, Service, ServiceCategory } = require('../../models');
const { equipmentPool, executeQuery } = require('../../../config/database');
const { tenantWhere, tenantId: getTenantId } = require('../../utils/tenantScope');

async function dbQ(sql, params = []) {
  return executeQuery(equipmentPool, sql, params.map(v => (v === undefined ? null : v)));
}

const SR_FULL_INCLUDE = [
  { model: ApprovalFlow, as: 'approvals', required: false },
  {
    model: Service, as: 'service', required: false,
    include: [{ model: ServiceCategory, as: 'categoria', required: false }],
  },
];

class ServiceRequestRepository {
  // ── ServiceRequest ───────────────────────────────────────────────────────

  async findAll(where, { page = 1, limit = 20, req } = {}) {
    const tenantFilter = req ? tenantWhere(req) : {};
    return ServiceRequest.findAndCountAll({
      where:   { ...where, ...tenantFilter },
      include: SR_FULL_INCLUDE,
      order:   [['createdAt', 'DESC']],
      limit:   parseInt(limit),
      offset:  (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async findById(id) {
    return ServiceRequest.findByPk(id, { include: SR_FULL_INCLUDE });
  }

  async findByIdForNotify(id) {
    return ServiceRequest.findByPk(id, {
      include: [{ model: Service, as: 'service', required: false }],
    });
  }

  async findByIdSimple(id) {
    return ServiceRequest.findByPk(id);
  }

  async create(data, req = null) {
    return ServiceRequest.create({
      id: uuidv4(),
      ...(req ? { tenantId: getTenantId(req) } : {}),
      ...data,
    });
  }

  async update(sr, patch) {
    await sr.update(patch);
    return sr;
  }

  // ── ApprovalFlow ─────────────────────────────────────────────────────────

  async createApproval({ serviceRequestId, approverId, status, comments }) {
    return ApprovalFlow.create({
      id: uuidv4(), serviceRequestId, approverId, status, comments, decidedAt: new Date(),
    });
  }

  // ── ServiceCategory / Service ────────────────────────────────────────────

  async getCatalog() {
    return ServiceCategory.findAll({
      where: { isActive: true },
      include: [{ model: Service, as: 'servicios', where: { isActive: true }, required: false }],
      order: [['name', 'ASC']],
    });
  }

  async findServiceById(id) {
    return Service.findByPk(id);
  }

  // ── Software catalog (raw SQL) ───────────────────────────────────────────

  async findSoftware(term) {
    if (term) {
      return dbQ(
        'SELECT * FROM catalog_software WHERE activo=1 AND (nombre LIKE ? OR proveedor LIKE ?) ORDER BY nombre ASC LIMIT 30',
        [`%${term}%`, `%${term}%`]
      );
    }
    return dbQ('SELECT * FROM catalog_software WHERE activo=1 ORDER BY nombre ASC LIMIT 100');
  }

  async createSoftware({ nombre, version, proveedor, categoria, detalles }) {
    return dbQ(
      'INSERT INTO catalog_software (nombre,version,proveedor,categoria,detalles) VALUES (?,?,?,?,?)',
      [nombre.trim(), version || null, proveedor || null, categoria || 'Software', detalles || null]
    );
  }

  async deactivateSoftware(id) {
    return dbQ('UPDATE catalog_software SET activo=0 WHERE id=?', [id]);
  }
}

module.exports = new ServiceRequestRepository();

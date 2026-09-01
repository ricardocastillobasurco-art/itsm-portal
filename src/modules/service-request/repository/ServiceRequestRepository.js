'use strict';

const { v4: uuidv4 } = require('uuid');
const TenantBaseRepository = require('../../../repositories/TenantBaseRepository');
const { ServiceRequest, ApprovalFlow, Service, ServiceCategory } = require('../../../models');
const { equipmentPool, executeQuery } = require('../../../../config/database');

const SR_INCLUDE = [
  { model: ApprovalFlow, as: 'approvals', required: false },
  {
    model: Service, as: 'service', required: false,
    include: [{ model: ServiceCategory, as: 'categoria', required: false }],
  },
];

async function dbQ(sql, params = []) {
  return executeQuery(equipmentPool, sql, params.map(v => (v === undefined ? null : v)));
}

class ServiceRequestRepository extends TenantBaseRepository {
  constructor(tenantId) {
    super(ServiceRequest, tenantId);
  }

  async findPaginated({ where = {}, page = 1, limit = 20 } = {}) {
    return ServiceRequest.findAndCountAll({
      where:   { ...where, ...this._scope() },
      include: SR_INCLUDE,
      order:   [['createdAt', 'DESC']],
      limit:   parseInt(limit),
      offset:  (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async findByIdWithDetails(id) {
    return ServiceRequest.findOne({
      where:   { id, ...this._scope() },
      include: SR_INCLUDE,
    });
  }

  async findByIdForNotify(id) {
    return ServiceRequest.findOne({
      where:   { id, ...this._scope() },
      include: [{ model: Service, as: 'service', required: false }],
    });
  }

  async findByIdSimple(id) {
    return ServiceRequest.findOne({ where: { id, ...this._scope() } });
  }

  async create(data) {
    return ServiceRequest.create({ id: uuidv4(), ...data, ...this._scope() });
  }

  async update(sr, patch) {
    await sr.update(patch);
    return sr;
  }

  async createApproval({ serviceRequestId, approverId, status, comments }) {
    return ApprovalFlow.create({ id: uuidv4(), serviceRequestId, approverId, status, comments, decidedAt: new Date() });
  }

  async findServiceById(id) {
    return Service.findByPk(id);
  }

  async getCatalog() {
    return ServiceCategory.findAll({
      where:   { isActive: true },
      include: [{ model: Service, as: 'servicios', where: { isActive: true }, required: false }],
      order:   [['name', 'ASC']],
    });
  }

  // ── Software catalog (raw SQL — tabla legacy sin tenant_id) ──────────────────
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

module.exports = ServiceRequestRepository;

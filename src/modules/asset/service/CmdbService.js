'use strict';

const CmdbRepository = require('../repository/CmdbRepository');
const { NotFoundError, ValidationError } = require('../../../utils/errors');
const { AssetPolicy } = require('../../../core/policies');

const ALLOWED_CI_FIELDS = ['name','status','environment','location','ipAddress','serialNumber','version','attributes'];

class CmdbService {
  constructor(tenantId) {
    this.repo = new CmdbRepository(tenantId);
  }

  async getTypes()  { return this.repo.findTypes(); }
  async getKPIs()   { return this.repo.getKPIs(); }

  async list(filters) {
    const { count, rows } = await this.repo.findPaginated(filters);
    return { rows, count };
  }

  async getById(id, pCtx = null) {
    const ci = await this.repo.findByIdWithRelations(id);
    if (!ci) throw new NotFoundError('CI no encontrado');
    if (pCtx) AssetPolicy.assertRead(pCtx, ci);
    return ci;
  }

  async create(data, pCtx = null) {
    const { ciTypeId, name, status, environment, ownerId, location, ipAddress, serialNumber, version, attributes } = data;
    if (pCtx) AssetPolicy.assertCreate(pCtx);
    if (!ciTypeId || !name) throw new ValidationError('ciTypeId y name requeridos');
    return this.repo.create({ ciTypeId, name, status, environment, ownerId, location, ipAddress, serialNumber, version, attributes });
  }

  async update(id, body, pCtx = null) {
    const ci = await this.repo.findByIdWithRelations(id);
    if (!ci) throw new NotFoundError('CI no encontrado');
    if (pCtx) AssetPolicy.assertUpdate(pCtx, ci);
    const updates = {};
    for (const key of ALLOWED_CI_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    return this.repo.update(id, updates);
  }

  async remove(id, pCtx = null) {
    const ci = await this.repo.findByIdWithRelations(id);
    if (!ci) throw new NotFoundError('CI no encontrado');
    if (pCtx) AssetPolicy.assertDelete(pCtx, ci);
    return this.repo.remove(id);
  }

  async addRelationship(sourceId, targetId, relationship, pCtx = null) {
    if (!targetId || !relationship) throw new ValidationError('targetId y relationship requeridos');
    if (pCtx) {
      const ci = await this.repo.findByIdWithRelations(sourceId);
      if (ci) AssetPolicy.assertManageRelationship(pCtx, ci);
    }
    return this.repo.addRelationship(sourceId, targetId, relationship);
  }

  async removeRelationship(relId) {
    return this.repo.removeRelationship(relId);
  }
}

module.exports = CmdbService;

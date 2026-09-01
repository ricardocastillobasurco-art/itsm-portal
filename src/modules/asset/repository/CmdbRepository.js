'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op, QueryTypes } = require('sequelize');
const { ConfigItem, CiType, CiRelationship } = require('../../../models');
const { NotFoundError } = require('../../../utils/errors');
const { TenantBaseRepository } = require('../../../repositories');
const sequelize = require('../../../config/database');

class CmdbRepository extends TenantBaseRepository {
  constructor(tenantId) {
    super(ConfigItem, tenantId);
  }

  async findTypes() {
    return CiType.findAll({ order: [['name', 'ASC']] });
  }

  async getKPIs() {
    const [r] = await sequelize.query(`
      SELECT
        CAST(COUNT(*)                         AS SIGNED) AS total,
        CAST(SUM(status = 'activo')           AS SIGNED) AS activos,
        CAST(SUM(status = 'inactivo')         AS SIGNED) AS inactivos,
        CAST(SUM(status = 'en_mantenimiento') AS SIGNED) AS mantenimiento,
        CAST(SUM(status = 'retirado')         AS SIGNED) AS retirados
      FROM config_items WHERE tenant_id = ?
    `, { replacements: [this.tenantId], type: QueryTypes.SELECT });
    const [relRow] = await sequelize.query(
      `SELECT CAST(COUNT(*) AS SIGNED) AS relaciones FROM ci_relationships cr
       JOIN config_items ci ON ci.id = cr.source_id
       WHERE ci.tenant_id = ?`,
      { replacements: [this.tenantId], type: QueryTypes.SELECT }
    );
    const row = r || {};
    return { total: row.total ?? 0, activos: row.activos ?? 0, inactivos: row.inactivos ?? 0, mantenimiento: row.mantenimiento ?? 0, retirados: row.retirados ?? 0, relaciones: relRow?.relaciones ?? 0 };
  }

  async findPaginated({ ciTypeId, status, environment, search, page = 1, limit = 25 } = {}) {
    const where = { ...this._scope() };
    if (ciTypeId)    where.ciTypeId    = ciTypeId;
    if (status)      where.status      = status;
    if (environment) where.environment = environment;
    if (search)      where.name        = { [Op.like]: `%${search}%` };

    return ConfigItem.findAndCountAll({
      where,
      include: [{ model: CiType, as: 'tipo' }],
      order:  [['name', 'ASC']],
      limit:  parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async findByIdWithRelations(id) {
    const ci = await ConfigItem.findOne({
      where:   { id, ...this._scope() },
      include: [{ model: CiType, as: 'tipo' }],
    });
    if (!ci) throw new NotFoundError(`CI ${id} no encontrado`);

    const [rels] = await sequelize.query(`
      SELECT cr.*, cr.relationship,
             src.name AS source_name, src_t.name AS source_type,
             tgt.name AS target_name, tgt_t.name AS target_type
      FROM ci_relationships cr
      JOIN config_items src ON cr.source_id = src.id
      JOIN config_items tgt ON cr.target_id = tgt.id
      JOIN ci_types src_t   ON src.ci_type_id = src_t.id
      JOIN ci_types tgt_t   ON tgt.ci_type_id = tgt_t.id
      WHERE cr.source_id = ? OR cr.target_id = ?
    `, { replacements: [ci.id, ci.id], type: QueryTypes.SELECT });

    return { ci, relationships: rels };
  }

  async create({ ciTypeId, name, status, environment, ownerId, location, ipAddress, serialNumber, version, attributes }) {
    return ConfigItem.create({
      id: uuidv4(),
      ...this._scope(),
      ciTypeId, name,
      status:       status      || 'activo',
      environment:  environment || 'produccion',
      ownerId:      ownerId     || null,
      location:     location    || null,
      ipAddress:    ipAddress   || null,
      serialNumber: serialNumber|| null,
      version:      version     || null,
      attributes:   attributes  || null,
    });
  }

  async update(id, updates) {
    const ci = await ConfigItem.findOne({ where: { id, ...this._scope() } });
    if (!ci) throw new NotFoundError(`CI ${id} no encontrado`);
    await ci.update(updates);
    return ci;
  }

  async remove(id) {
    const ci = await ConfigItem.findOne({ where: { id, ...this._scope() } });
    if (!ci) throw new NotFoundError(`CI ${id} no encontrado`);
    await ci.destroy();
    return true;
  }

  async addRelationship(sourceId, targetId, relationship) {
    return CiRelationship.create({ id: uuidv4(), sourceId, targetId, relationship });
  }

  async removeRelationship(relId) {
    const rel = await CiRelationship.findByPk(relId);
    if (!rel) throw new NotFoundError(`Relación ${relId} no encontrada`);
    await rel.destroy();
    return true;
  }
}

module.exports = CmdbRepository;

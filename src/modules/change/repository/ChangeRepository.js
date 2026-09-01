'use strict';

const { v4: uuidv4 } = require('uuid');
const { QueryTypes } = require('sequelize');
const { Change } = require('../../../models');
const { TenantBaseRepository } = require('../../../repositories');
const sequelize = require('../../../config/database');

class ChangeRepository extends TenantBaseRepository {
  constructor(tenantId) {
    super(Change, tenantId);
  }

  async findPaginated({ status, type, risk, page = 1, limit = 20 } = {}) {
    const where = { ...this._scope() };
    if (status) where.status    = status;
    if (type)   where.type      = type;
    if (risk)   where.riskLevel = risk;

    return Change.findAndCountAll({
      where,
      order:  [['createdAt', 'DESC']],
      limit:  parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async getKPIs() {
    const [r] = await sequelize.query(`
      SELECT
        CAST(SUM(status NOT IN ('implementado','cancelado','revisado'))         AS SIGNED) AS activos,
        CAST(SUM(status = 'pendiente_aprobacion')                               AS SIGNED) AS pendientes,
        CAST(SUM(status IN ('implementado','revisado'))                          AS SIGNED) AS implementados,
        CAST(SUM(type = 'emergencia' AND status NOT IN ('cancelado','revisado')) AS SIGNED) AS emergencias
      FROM changes WHERE tenant_id = ?
    `, { replacements: [this.tenantId], type: QueryTypes.SELECT });
    const row = r || {};
    return { activos: row.activos ?? 0, pendientes: row.pendientes ?? 0, implementados: row.implementados ?? 0, emergencias: row.emergencias ?? 0 };
  }

  async findById(id) {
    return Change.findOne({ where: { id, ...this._scope() } });
  }

  async create(data) {
    const today  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `CHG-${today}-`;
    const [row]  = await sequelize.query(
      `SELECT change_number FROM changes WHERE change_number LIKE ? AND tenant_id = ? ORDER BY change_number DESC LIMIT 1`,
      { replacements: [`${prefix}%`, this.tenantId], type: QueryTypes.SELECT }
    );
    const seq          = row ? parseInt(row.change_number.split('-').pop()) + 1 : 1;
    const changeNumber = `${prefix}${String(seq).padStart(4, '0')}`;

    return Change.create({ id: uuidv4(), changeNumber, ...this._scope(), ...data });
  }

  async update(id, updates) {
    const ch = await Change.findOne({ where: { id, ...this._scope() } });
    if (!ch) return null;
    await ch.update(updates);
    return ch;
  }

  async remove(id) {
    const ch = await Change.findOne({ where: { id, ...this._scope() } });
    if (!ch) return false;
    await ch.destroy();
    return true;
  }
}

module.exports = ChangeRepository;

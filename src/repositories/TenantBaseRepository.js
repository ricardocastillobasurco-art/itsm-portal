'use strict';

const BaseRepository = require('./BaseRepository');
const { NotFoundError } = require('../utils/errors');

/**
 * TenantBaseRepository — extiende BaseRepository con aislamiento automático por tenant.
 *
 * TODAS las queries se filtran por tenant_id automáticamente.
 * Es imposible leer o escribir datos de otro tenant usando esta clase.
 *
 * Uso:
 *   class TicketRepository extends TenantBaseRepository {
 *     constructor(tenantId) { super(TicketModel, tenantId); }
 *   }
 *   const repo = new TicketRepository(req.tenant.id);
 *   await repo.findAll({ status: 'open' }); // tenant_id se añade automáticamente
 */
class TenantBaseRepository extends BaseRepository {
  constructor(model, tenantId) {
    if (!tenantId) throw new Error('TenantBaseRepository requiere tenantId — no se permiten queries sin tenant scope');
    super(model);
    this.tenantId = tenantId;
  }

  _scope() {
    return { tenant_id: this.tenantId };
  }

  async findAll(where = {}, options = {}) {
    return this.model.findAll({
      where: { ...where, ...this._scope() },
      ...options,
    });
  }

  async findOne(where = {}, options = {}) {
    return this.model.findOne({
      where: { ...where, ...this._scope() },
      ...options,
    });
  }

  async findById(id, options = {}) {
    const record = await this.model.findOne({
      where: { id, ...this._scope() },
      ...options,
    });
    if (!record) throw new NotFoundError(`${this.model.name} ${id} no encontrado`);
    return record;
  }

  async create(data) {
    return this.model.create({ ...data, ...this._scope() });
  }

  async update(id, data) {
    const [affected] = await this.model.update(data, {
      where: { id, ...this._scope() },
    });
    if (!affected) throw new NotFoundError(`${this.model.name} ${id} no encontrado`);
    return this.findById(id);
  }

  async delete(id) {
    return this.model.destroy({ where: { id, ...this._scope() } });
  }

  async count(where = {}) {
    return this.model.count({ where: { ...where, ...this._scope() } });
  }

  async findAndCountAll(where = {}, options = {}) {
    return this.model.findAndCountAll({
      where: { ...where, ...this._scope() },
      ...options,
    });
  }

  // Guard: bloquea queries globales — llama a findAll() con where explícito si lo necesitas
  async findAllGlobal() {
    throw new Error('Queries globales bloqueadas en TenantBaseRepository. Usa findAll() — tenant_id se aplica automáticamente.');
  }
}

module.exports = TenantBaseRepository;

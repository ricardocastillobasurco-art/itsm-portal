'use strict';

const repo = require('../repository/ProblemRepository');
const { NotFoundError, ValidationError } = require('../../../utils/errors');

const ALLOWED = ['title','description','status','priority','assignedTo','rootCause','workaround','resolution'];

// tenantId es obligatorio en todas las operaciones (tenantScope.tenantId(req)).
class ProblemService {
  async list(filters) {
    const { count, rows } = await repo.findPaginated(filters);
    return { rows, count };
  }

  async getKPIs(tenantId) { return repo.getKPIs(tenantId); }

  async getById(id, tenantId) {
    const p = await repo.findByIdWithKnownErrors(id, tenantId);
    if (!p) throw new NotFoundError('Problema no encontrado');
    return p;
  }

  async create({ title, description, priority, workaround, assignedTo }, tenantId) {
    if (!title) throw new ValidationError('Título requerido');
    return repo.create({ title, description, priority: priority || 'media',
                         workaround: workaround || null, assignedTo }, tenantId);
  }

  async update(id, body, tenantId) {
    const updates = {};
    for (const key of ALLOWED) { if (body[key] !== undefined) updates[key] = body[key]; }
    if (updates.status === 'resuelto' || updates.status === 'cerrado') updates.resolvedAt = new Date();
    const p = await repo.update(id, updates, tenantId);
    if (!p) throw new NotFoundError('Problema no encontrado');
    return p;
  }

  async addKnownError(problemId, data, tenantId) {
    const p = await repo.findByIdWithKnownErrors(problemId, tenantId);
    if (!p) throw new NotFoundError('Problema no encontrado');
    return repo.addKnownError(problemId, data, tenantId);
  }
}

module.exports = new ProblemService();

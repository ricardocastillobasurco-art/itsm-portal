'use strict';

const repo = require('../repository/ProblemRepository');
const { NotFoundError, ValidationError } = require('../../../utils/errors');

const ALLOWED = ['title','description','status','priority','assignedTo','rootCause','workaround','resolution'];

class ProblemService {
  async list(filters) {
    const { count, rows } = await repo.findPaginated(filters);
    return { rows, count };
  }

  async getKPIs() { return repo.getKPIs(); }

  async getById(id) {
    const p = await repo.findByIdWithKnownErrors(id);
    if (!p) throw new NotFoundError('Problema no encontrado');
    return p;
  }

  async create({ title, description, priority, workaround, assignedTo }) {
    if (!title) throw new ValidationError('Título requerido');
    return repo.create({ title, description, priority: priority || 'media',
                         workaround: workaround || null, assignedTo });
  }

  async update(id, body) {
    const updates = {};
    for (const key of ALLOWED) { if (body[key] !== undefined) updates[key] = body[key]; }
    if (updates.status === 'resuelto' || updates.status === 'cerrado') updates.resolvedAt = new Date();
    const p = await repo.update(id, updates);
    if (!p) throw new NotFoundError('Problema no encontrado');
    return p;
  }

  async addKnownError(problemId, data) {
    const p = await repo.findByIdWithKnownErrors(problemId);
    if (!p) throw new NotFoundError('Problema no encontrado');
    return repo.addKnownError(problemId, data);
  }
}

module.exports = new ProblemService();

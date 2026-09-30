'use strict';

const { v4: uuidv4 } = require('uuid');
const { QueryTypes } = require('sequelize');
const { Problem, KnownError } = require('../../../models');
const sequelize = require('../../../config/database');

function requireTenant(tenantId) {
  if (!tenantId) throw new Error('ProblemRepository requiere tenantId');
  return Number(tenantId);
}

// Todas las operaciones reciben tenantId: los problemas son de cada cliente.
class ProblemRepository {
  async findPaginated({ status, priority, page = 1, limit = 20, tenantId } = {}) {
    const where = { tenantId: requireTenant(tenantId) };
    if (status)   where.status   = status;
    if (priority) where.priority = priority;

    return Problem.findAndCountAll({
      where,
      include: [{ model: KnownError, as: 'erroresConocidos', required: false }],
      order:   [['createdAt', 'DESC']],
      limit:   parseInt(limit),
      offset:  (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async getKPIs(tenantId) {
    const tid = requireTenant(tenantId);
    const [r] = await sequelize.query(`
      SELECT
        CAST(SUM(status NOT IN ('resuelto','cerrado')) AS SIGNED) AS abiertos,
        CAST(SUM(status = 'en_investigacion')           AS SIGNED) AS investigacion,
        CAST(SUM(status = 'conocido')                   AS SIGNED) AS conocidos,
        CAST(SUM(status IN ('resuelto','cerrado'))       AS SIGNED) AS resueltos
      FROM problems
      WHERE tenant_id = ?
    `, { replacements: [tid], type: QueryTypes.SELECT });
    const [ke] = await sequelize.query(
      `SELECT CAST(COUNT(*) AS SIGNED) AS total FROM known_errors WHERE is_published = 1 AND tenant_id = ?`,
      { replacements: [tid], type: QueryTypes.SELECT }
    );
    const row = r || {};
    return { abiertos: row.abiertos ?? 0, investigacion: row.investigacion ?? 0, conocidos: row.conocidos ?? 0, resueltos: row.resueltos ?? 0, erroresPublicados: ke?.total ?? 0 };
  }

  async findByIdWithKnownErrors(id, tenantId) {
    return Problem.findOne({
      where:   { id, tenantId: requireTenant(tenantId) },
      include: [{ model: KnownError, as: 'erroresConocidos' }],
    });
  }

  async create(data, tenantId) {
    // Numeración global: problem_number es único en toda la plataforma
    const year   = new Date().getFullYear();
    const prefix = `PRB-${year}-`;
    const [row]  = await sequelize.query(
      `SELECT problem_number FROM problems /* tenant_id: numeración global */ WHERE problem_number LIKE ? ORDER BY problem_number DESC LIMIT 1`,
      { replacements: [`${prefix}%`], type: QueryTypes.SELECT }
    );
    const seq           = row ? parseInt(row.problem_number.split('-').pop()) + 1 : 1;
    const problemNumber = `${prefix}${String(seq).padStart(4, '0')}`;

    return Problem.create({ id: uuidv4(), problemNumber, ...data, tenantId: requireTenant(tenantId) });
  }

  async update(id, updates, tenantId) {
    const p = await Problem.findOne({ where: { id, tenantId: requireTenant(tenantId) } });
    if (!p) return null;
    await p.update(updates);
    return p;
  }

  async addKnownError(problemId, { title, symptoms, workaround, resolution, isPublished }, tenantId) {
    return KnownError.create({
      id: uuidv4(),
      problemId,
      title, symptoms, workaround, resolution,
      isPublished:  !!isPublished,
      publishedAt:  isPublished ? new Date() : null,
      tenantId:     requireTenant(tenantId),
    });
  }
}

module.exports = new ProblemRepository();

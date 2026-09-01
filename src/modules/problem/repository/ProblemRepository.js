'use strict';

const { v4: uuidv4 } = require('uuid');
const { QueryTypes } = require('sequelize');
const { Problem, KnownError } = require('../../../models');
const sequelize = require('../../../config/database');

class ProblemRepository {
  async findPaginated({ status, priority, page = 1, limit = 20 } = {}) {
    const where = {};
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

  async getKPIs() {
    const [r] = await sequelize.query(`
      SELECT
        CAST(SUM(status NOT IN ('resuelto','cerrado')) AS SIGNED) AS abiertos,
        CAST(SUM(status = 'en_investigacion')           AS SIGNED) AS investigacion,
        CAST(SUM(status = 'conocido')                   AS SIGNED) AS conocidos,
        CAST(SUM(status IN ('resuelto','cerrado'))       AS SIGNED) AS resueltos
      FROM problems
    `, { type: QueryTypes.SELECT });
    const [ke] = await sequelize.query(
      `SELECT CAST(COUNT(*) AS SIGNED) AS total FROM known_errors WHERE is_published = 1`,
      { type: QueryTypes.SELECT }
    );
    const row = r || {};
    return { abiertos: row.abiertos ?? 0, investigacion: row.investigacion ?? 0, conocidos: row.conocidos ?? 0, resueltos: row.resueltos ?? 0, erroresPublicados: ke?.total ?? 0 };
  }

  async findByIdWithKnownErrors(id) {
    return Problem.findByPk(id, {
      include: [{ model: KnownError, as: 'erroresConocidos' }],
    });
  }

  async create(data) {
    const year   = new Date().getFullYear();
    const prefix = `PRB-${year}-`;
    const [row]  = await sequelize.query(
      `SELECT problem_number FROM problems WHERE problem_number LIKE ? ORDER BY problem_number DESC LIMIT 1`,
      { replacements: [`${prefix}%`], type: QueryTypes.SELECT }
    );
    const seq           = row ? parseInt(row.problem_number.split('-').pop()) + 1 : 1;
    const problemNumber = `${prefix}${String(seq).padStart(4, '0')}`;

    return Problem.create({ id: uuidv4(), problemNumber, ...data });
  }

  async update(id, updates) {
    const p = await Problem.findByPk(id);
    if (!p) return null;
    await p.update(updates);
    return p;
  }

  async addKnownError(problemId, { title, symptoms, workaround, resolution, isPublished }) {
    return KnownError.create({
      id: uuidv4(),
      problemId,
      title, symptoms, workaround, resolution,
      isPublished:  !!isPublished,
      publishedAt:  isPublished ? new Date() : null,
    });
  }
}

module.exports = new ProblemRepository();

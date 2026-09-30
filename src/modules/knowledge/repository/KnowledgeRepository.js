'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op, QueryTypes } = require('sequelize');
const { KbArticle, KbCategory } = require('../../../models');
const sequelize = require('../../../config/database');

const ARTICLE_INCLUDE = [{ model: KbCategory, as: 'categoria' }];

function requireTenant(tenantId) {
  if (!tenantId) throw new Error('KnowledgeRepository requiere tenantId');
  return Number(tenantId);
}

// Todas las operaciones reciben tenantId: la base de conocimiento es de cada cliente.
class KnowledgeRepository {
  // ── Categorías ────────────────────────────────────────────────────────────

  async findCategories(tenantId) {
    const tid = requireTenant(tenantId);
    return KbCategory.findAll({
      where:   { tenantId: tid },
      order:   [['sortOrder', 'ASC'], ['name', 'ASC']],
      include: [{ model: KbArticle, as: 'articulos', where: { status: 'publicado', deletedAt: null, tenantId: tid }, required: false }],
    });
  }

  // ── Artículos ─────────────────────────────────────────────────────────────

  async findPaginated({ categoryId, status = 'publicado', page = 1, limit = 20, admin, tenantId } = {}) {
    const where = { deletedAt: null, tenantId: requireTenant(tenantId) };
    if (!admin && status && status !== 'all') where.status = status;
    else if (!admin) where.status = 'publicado';
    if (categoryId) where.kbCategoryId = categoryId;

    return KbArticle.findAndCountAll({
      where,
      include: ARTICLE_INCLUDE,
      order:   [['views', 'DESC'], ['createdAt', 'DESC']],
      limit:   parseInt(limit),
      offset:  (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async search(q, limit = 10, tenantId) {
    const where = {
      status: 'publicado', deletedAt: null, tenantId: requireTenant(tenantId),
      [Op.or]: [
        { title:   { [Op.like]: `%${q}%` } },
        { content: { [Op.like]: `%${q}%` } },
        { tags:    { [Op.like]: `%${q}%` } },
      ],
    };
    const count    = await KbArticle.count({ where });
    const articles = await KbArticle.findAll({ where, include: ARTICLE_INCLUDE,
                                               order: [['views', 'DESC']], limit: parseInt(limit) });
    return { articles, count };
  }

  async suggest(q, tenantId) {
    const where = {
      status: 'publicado', deletedAt: null, tenantId: requireTenant(tenantId),
      [Op.or]: [{ title: { [Op.like]: `%${q}%` } }, { tags: { [Op.like]: `%${q}%` } }],
    };
    return KbArticle.findAll({ where, limit: 5, attributes: ['id', 'title', 'excerpt', 'views'] });
  }

  async popular(tenantId) {
    const where = { status: 'publicado', deletedAt: null, tenantId: requireTenant(tenantId) };
    return KbArticle.findAll({ where, order: [['views', 'DESC']], limit: 5, include: ARTICLE_INCLUDE });
  }

  async noResultsQueries(tenantId) {
    return sequelize.query(`
      SELECT query, COUNT(*) AS searches, SUM(results = 0) AS sin_resultado
      FROM kb_search_log WHERE tenant_id = ? GROUP BY query
      HAVING sin_resultado > 0 ORDER BY searches DESC LIMIT 20
    `, { replacements: [requireTenant(tenantId)], type: QueryTypes.SELECT });
  }

  async findById(id, tenantId) {
    return KbArticle.findOne({ where: { id, deletedAt: null, tenantId: requireTenant(tenantId) }, include: ARTICLE_INCLUDE });
  }

  async create({ authorId, title, content, kbCategoryId, tags, status, excerpt }, tenantId) {
    return KbArticle.create({
      id: uuidv4(), authorId, title, content, kbCategoryId, tags,
      tenantId: requireTenant(tenantId),
      status:  status  || 'borrador',
      excerpt: excerpt || content.replace(/<[^>]+>/g, '').substring(0, 200),
    });
  }

  async update(id, updates, tenantId) {
    const article = await KbArticle.findOne({ where: { id, deletedAt: null, tenantId: requireTenant(tenantId) } });
    if (!article) return null;
    await article.update(updates);
    return article;
  }

  async remove(id, tenantId) {
    const article = await KbArticle.findOne({ where: { id, deletedAt: null, tenantId: requireTenant(tenantId) } });
    if (!article) return false;
    await article.destroy();
    return true;
  }

  /* tenant_id: el artículo ya fue validado por findById(id, tenantId) en el servicio */
  async incrementViews(id)      { return KbArticle.increment('views',      { where: { id } }); }
  async incrementHelpfulYes(id) { return KbArticle.increment('helpfulYes', { where: { id } }); } /* tenant_id: ídem */
  async incrementHelpfulNo(id)  { return KbArticle.increment('helpfulNo',  { where: { id } }); } /* tenant_id: ídem */

  async logSearch(query, results, userId, tenantId) {
    await sequelize.query(
      'INSERT INTO kb_search_log (query, results, user_id, tenant_id) VALUES (?, ?, ?, ?)',
      { replacements: [query, results, userId, requireTenant(tenantId)], type: QueryTypes.INSERT }
    );
  }

  async linkTicket(articleId, ticketId, linkedBy) {
    await sequelize.query(
      'INSERT IGNORE INTO kb_article_tickets /* tenant_id: artículo y ticket validados en el servicio */ (article_id, ticket_id, linked_by) VALUES (?,?,?)',
      { replacements: [articleId, ticketId, linkedBy], type: QueryTypes.INSERT }
    );
  }

  // ── Procedimientos ────────────────────────────────────────────────────────

  async findProcedures(category, tenantId) {
    const tid    = requireTenant(tenantId);
    const where  = category ? 'WHERE procedure_category = ? AND active = 1 AND tenant_id = ?' : 'WHERE active = 1 AND tenant_id = ?';
    const params = category ? [category, tid] : [tid];
    return sequelize.query(
      `SELECT id, title, description, procedure_category, content_type, file_name, created_by, created_at /* tenant_id: en where */
       FROM kb_procedures ${where} ORDER BY sort_order ASC, created_at DESC`,
      { replacements: params, type: QueryTypes.SELECT }
    );
  }

  async findProcedureById(id, tenantId) {
    const rows = await sequelize.query(
      `SELECT * FROM kb_procedures WHERE id = ? AND active = 1 AND tenant_id = ?`,
      { replacements: [id, requireTenant(tenantId)], type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  }

  async createProcedure({ title, description, procedure_category, content_type, content_data, file_name, created_by }, tenantId) {
    await sequelize.query(
      `INSERT INTO kb_procedures (title, description, procedure_category, content_type, content_data, file_name, created_by, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [title, description, procedure_category, content_type, content_data, file_name, created_by, requireTenant(tenantId)],
        type: QueryTypes.INSERT }
    );
  }

  async deactivateProcedure(id, tenantId) {
    await sequelize.query(
      `UPDATE kb_procedures SET active = 0 WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, requireTenant(tenantId)], type: QueryTypes.UPDATE }
    );
  }

  // ── Solicitudes de procedimiento ──────────────────────────────────────────

  async findProcedureRequests(tenantId) {
    return sequelize.query(
      `SELECT * FROM kb_procedure_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
      { replacements: [requireTenant(tenantId)], type: QueryTypes.SELECT }
    );
  }

  async createProcedureRequest({ userId, userName, userEmail, query, description }, tenantId) {
    await sequelize.query(
      `INSERT INTO kb_procedure_requests (user_id, user_name, user_email, query, description, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
      { replacements: [userId, userName, userEmail, query, description, requireTenant(tenantId)], type: QueryTypes.INSERT }
    );
  }

  async updateProcedureRequestStatus(id, status, tenantId) {
    const resolved = status === 'resuelto' ? 'NOW()' : 'NULL';
    await sequelize.query(
      `UPDATE kb_procedure_requests SET status = ?, resolved_at = ${resolved} WHERE id = ? AND tenant_id = ?`,
      { replacements: [status, id, requireTenant(tenantId)], type: QueryTypes.UPDATE }
    );
  }
}

module.exports = new KnowledgeRepository();

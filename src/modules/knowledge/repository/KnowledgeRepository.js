'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op, QueryTypes } = require('sequelize');
const { KbArticle, KbCategory } = require('../../../models');
const sequelize = require('../../../config/database');

const ARTICLE_INCLUDE = [{ model: KbCategory, as: 'categoria' }];

class KnowledgeRepository {
  // ── Categorías ────────────────────────────────────────────────────────────

  async findCategories(tenantId) {
    const artWhere = { status: 'publicado', deletedAt: null };
    if (tenantId) artWhere.tenantId = tenantId;
    return KbCategory.findAll({
      order:   [['sortOrder', 'ASC'], ['name', 'ASC']],
      include: [{ model: KbArticle, as: 'articulos', where: artWhere, required: false }],
    });
  }

  // ── Artículos ─────────────────────────────────────────────────────────────

  async findPaginated({ categoryId, status = 'publicado', page = 1, limit = 20, admin, tenantId } = {}) {
    const where = { deletedAt: null };
    if (!admin && status && status !== 'all') where.status = status;
    else if (!admin) where.status = 'publicado';
    if (categoryId) where.kbCategoryId = categoryId;
    if (tenantId)   where.tenantId = tenantId;

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
      status: 'publicado', deletedAt: null,
      [Op.or]: [
        { title:   { [Op.like]: `%${q}%` } },
        { content: { [Op.like]: `%${q}%` } },
        { tags:    { [Op.like]: `%${q}%` } },
      ],
    };
    if (tenantId) where.tenantId = tenantId;
    const count    = await KbArticle.count({ where });
    const articles = await KbArticle.findAll({ where, include: ARTICLE_INCLUDE,
                                               order: [['views', 'DESC']], limit: parseInt(limit) });
    return { articles, count };
  }

  async suggest(q, tenantId) {
    const where = {
      status: 'publicado', deletedAt: null,
      [Op.or]: [{ title: { [Op.like]: `%${q}%` } }, { tags: { [Op.like]: `%${q}%` } }],
    };
    if (tenantId) where.tenantId = tenantId;
    return KbArticle.findAll({ where, limit: 5, attributes: ['id', 'title', 'excerpt', 'views'] });
  }

  async popular(tenantId) {
    const where = { status: 'publicado', deletedAt: null };
    if (tenantId) where.tenantId = tenantId;
    return KbArticle.findAll({ where, order: [['views', 'DESC']], limit: 5, include: ARTICLE_INCLUDE });
  }

  async noResultsQueries() {
    return sequelize.query(`
      SELECT query, COUNT(*) AS searches, SUM(results = 0) AS sin_resultado
      FROM kb_search_log GROUP BY query
      HAVING sin_resultado > 0 ORDER BY searches DESC LIMIT 20
    `, { type: QueryTypes.SELECT });
  }

  async findById(id) {
    return KbArticle.findOne({ where: { id, deletedAt: null }, include: ARTICLE_INCLUDE });
  }

  async create({ authorId, title, content, kbCategoryId, tags, status, excerpt }) {
    return KbArticle.create({
      id: uuidv4(), authorId, title, content, kbCategoryId, tags,
      status:  status  || 'borrador',
      excerpt: excerpt || content.replace(/<[^>]+>/g, '').substring(0, 200),
    });
  }

  async update(id, updates) {
    const article = await KbArticle.findOne({ where: { id, deletedAt: null } });
    if (!article) return null;
    await article.update(updates);
    return article;
  }

  async remove(id) {
    const article = await KbArticle.findOne({ where: { id, deletedAt: null } });
    if (!article) return false;
    await article.destroy();
    return true;
  }

  async incrementViews(id)      { return KbArticle.increment('views',      { where: { id } }); }
  async incrementHelpfulYes(id) { return KbArticle.increment('helpfulYes', { where: { id } }); }
  async incrementHelpfulNo(id)  { return KbArticle.increment('helpfulNo',  { where: { id } }); }

  async logSearch(query, results, userId) {
    await sequelize.query(
      'INSERT INTO kb_search_log (query, results, user_id) VALUES (?, ?, ?)',
      { replacements: [query, results, userId], type: QueryTypes.INSERT }
    );
  }

  async linkTicket(articleId, ticketId, linkedBy) {
    await sequelize.query(
      'INSERT IGNORE INTO kb_article_tickets (article_id, ticket_id, linked_by) VALUES (?,?,?)',
      { replacements: [articleId, ticketId, linkedBy], type: QueryTypes.INSERT }
    );
  }

  // ── Procedimientos ────────────────────────────────────────────────────────

  async findProcedures(category) {
    const where  = category ? 'WHERE procedure_category = ? AND active = 1' : 'WHERE active = 1';
    const params = category ? [category] : [];
    return sequelize.query(
      `SELECT id, title, description, procedure_category, content_type, file_name, created_by, created_at
       FROM kb_procedures ${where} ORDER BY sort_order ASC, created_at DESC`,
      { replacements: params, type: QueryTypes.SELECT }
    );
  }

  async findProcedureById(id) {
    const rows = await sequelize.query(
      `SELECT * FROM kb_procedures WHERE id = ? AND active = 1`,
      { replacements: [id], type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  }

  async createProcedure({ title, description, procedure_category, content_type, content_data, file_name, created_by }) {
    await sequelize.query(
      `INSERT INTO kb_procedures (title, description, procedure_category, content_type, content_data, file_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [title, description, procedure_category, content_type, content_data, file_name, created_by],
        type: QueryTypes.INSERT }
    );
  }

  async deactivateProcedure(id) {
    await sequelize.query(
      `UPDATE kb_procedures SET active = 0 WHERE id = ?`,
      { replacements: [id], type: QueryTypes.UPDATE }
    );
  }

  // ── Solicitudes de procedimiento ──────────────────────────────────────────

  async findProcedureRequests() {
    return sequelize.query(
      `SELECT * FROM kb_procedure_requests ORDER BY created_at DESC LIMIT 200`,
      { type: QueryTypes.SELECT }
    );
  }

  async createProcedureRequest({ userId, userName, userEmail, query, description }) {
    await sequelize.query(
      `INSERT INTO kb_procedure_requests (user_id, user_name, user_email, query, description) VALUES (?, ?, ?, ?, ?)`,
      { replacements: [userId, userName, userEmail, query, description], type: QueryTypes.INSERT }
    );
  }

  async updateProcedureRequestStatus(id, status) {
    const resolved = status === 'resuelto' ? 'NOW()' : 'NULL';
    await sequelize.query(
      `UPDATE kb_procedure_requests SET status = ?, resolved_at = ${resolved} WHERE id = ?`,
      { replacements: [status, id], type: QueryTypes.UPDATE }
    );
  }
}

module.exports = new KnowledgeRepository();

'use strict';

const repo = require('../repository/KnowledgeRepository');
const { NotFoundError, ValidationError, ForbiddenError } = require('../../../utils/errors');

const ADMIN_ROLES  = ['administrador', 'especialista'];
const ALLOWED_FIELDS = ['title','content','kbCategoryId','tags','status','excerpt','tipo'];
const VALID_STATUS   = ['borrador','publicado','archivado','revision','oculto'];
const VALID_PR_STATUS = ['pendiente','en_progreso','resuelto'];

class KnowledgeService {
  async getCategories(tenantId) { return repo.findCategories(tenantId); }

  async list(filters) {
    const { count, rows } = await repo.findPaginated(filters);
    return { rows, count };
  }

  async search(q, limit, userId, tenantId) {
    if (!q?.trim()) return [];
    const { articles, count } = await repo.search(q.trim(), limit, tenantId);
    await repo.logSearch(q.trim(), count, userId);
    return articles;
  }

  async suggest(q, tenantId) {
    if (!q?.trim()) return [];
    return repo.suggest(q.trim(), tenantId);
  }

  async popular(tenantId) { return repo.popular(tenantId); }

  async noResults() { return repo.noResultsQueries(); }

  async getById(id) {
    const article = await repo.findById(id);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    await repo.incrementViews(id);
    return article;
  }

  async create({ authorId, title, content, kbCategoryId, tags, status, excerpt }) {
    if (!title || !content) throw new ValidationError('Título y contenido requeridos');
    return repo.create({ authorId, title, content, kbCategoryId, tags, status, excerpt });
  }

  async update(id, body) {
    const updates = {};
    for (const k of ALLOWED_FIELDS) { if (body[k] !== undefined) updates[k] = body[k]; }
    // tags debe ser siempre string
    if (updates.tags != null && typeof updates.tags !== 'string') updates.tags = String(updates.tags);
    // validar status
    if (updates.status && !VALID_STATUS.includes(updates.status)) delete updates.status;
    const article = await repo.update(id, updates);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    return article;
  }

  async remove(id) {
    const ok = await repo.remove(id);
    if (!ok) throw new NotFoundError('Artículo no encontrado');
  }

  async vote(id, vote) {
    const article = await repo.findById(id);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    if (vote === 'yes') await repo.incrementHelpfulYes(id);
    else                await repo.incrementHelpfulNo(id);
  }

  async linkTicket(articleId, ticketId, linkedBy) {
    if (!ticketId) throw new ValidationError('ticketId requerido');
    await repo.linkTicket(articleId, ticketId, linkedBy);
  }

  // ── Procedimientos ────────────────────────────────────────────────────────

  async getProcedures(category)   { return repo.findProcedures(category); }
  async getProcedureById(id) {
    const p = await repo.findProcedureById(id);
    if (!p) throw new NotFoundError('Procedimiento no encontrado');
    return p;
  }

  async createProcedure({ title, description, procedure_category, content_type, content_data, file_name }, user) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    if (!title?.trim()) throw new ValidationError('Título requerido');
    await repo.createProcedure({
      title: title.trim(),
      description:        description        || '',
      procedure_category: procedure_category || 'general',
      content_type:       content_type       || 'text',
      content_data:       content_data       || '',
      file_name:          file_name          || '',
      created_by: user.full_name || user.nombre || user.username || '',
    });
  }

  async deactivateProcedure(id, user) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    await repo.deactivateProcedure(id);
  }

  // ── Solicitudes de procedimiento ──────────────────────────────────────────

  async getProcedureRequests(user) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    return repo.findProcedureRequests();
  }

  async createProcedureRequest({ query, description }, user, body) {
    if (!query?.trim()) throw new ValidationError('Descripción requerida');
    await repo.createProcedureRequest({
      userId:    user ? user.id : null,
      userName:  (body.user_name  || user?.full_name || user?.nombre || user?.username || '').toString(),
      userEmail: (body.user_email || user?.email || '').toString(),
      query:     query.trim(),
      description: description || '',
    });
  }

  async updateProcedureRequestStatus(id, status, user) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    if (!VALID_PR_STATUS.includes(status)) throw new ValidationError('Estado inválido');
    await repo.updateProcedureRequestStatus(id, status);
  }
}

module.exports = new KnowledgeService();

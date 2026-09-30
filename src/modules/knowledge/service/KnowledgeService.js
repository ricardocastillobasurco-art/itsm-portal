'use strict';

const repo = require('../repository/KnowledgeRepository');
const { NotFoundError, ValidationError, ForbiddenError } = require('../../../utils/errors');

const ADMIN_ROLES  = ['administrador', 'especialista'];
const ALLOWED_FIELDS = ['title','content','kbCategoryId','tags','status','excerpt','tipo'];
const VALID_STATUS   = ['borrador','publicado','archivado','revision','oculto'];
const VALID_PR_STATUS = ['pendiente','en_progreso','resuelto'];

// tenantId es obligatorio en todas las operaciones (tenantScope.tenantId(req)).
class KnowledgeService {
  async getCategories(tenantId) { return repo.findCategories(tenantId); }

  async list(filters) {
    const { count, rows } = await repo.findPaginated(filters);
    return { rows, count };
  }

  async search(q, limit, userId, tenantId) {
    if (!q?.trim()) return [];
    const { articles, count } = await repo.search(q.trim(), limit, tenantId);
    await repo.logSearch(q.trim(), count, userId, tenantId);
    return articles;
  }

  async suggest(q, tenantId) {
    if (!q?.trim()) return [];
    return repo.suggest(q.trim(), tenantId);
  }

  async popular(tenantId) { return repo.popular(tenantId); }

  async noResults(tenantId) { return repo.noResultsQueries(tenantId); }

  async getById(id, tenantId) {
    const article = await repo.findById(id, tenantId);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    await repo.incrementViews(id);
    return article;
  }

  async create({ authorId, title, content, kbCategoryId, tags, status, excerpt }, tenantId) {
    if (!title || !content) throw new ValidationError('Título y contenido requeridos');
    return repo.create({ authorId, title, content, kbCategoryId, tags, status, excerpt }, tenantId);
  }

  async update(id, body, tenantId) {
    const updates = {};
    for (const k of ALLOWED_FIELDS) { if (body[k] !== undefined) updates[k] = body[k]; }
    // tags debe ser siempre string
    if (updates.tags != null && typeof updates.tags !== 'string') updates.tags = String(updates.tags);
    // validar status
    if (updates.status && !VALID_STATUS.includes(updates.status)) delete updates.status;
    const article = await repo.update(id, updates, tenantId);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    return article;
  }

  async remove(id, tenantId) {
    const ok = await repo.remove(id, tenantId);
    if (!ok) throw new NotFoundError('Artículo no encontrado');
  }

  async vote(id, vote, tenantId) {
    const article = await repo.findById(id, tenantId);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    if (vote === 'yes') await repo.incrementHelpfulYes(id);
    else                await repo.incrementHelpfulNo(id);
  }

  async linkTicket(articleId, ticketId, linkedBy, tenantId) {
    if (!ticketId) throw new ValidationError('ticketId requerido');
    const article = await repo.findById(articleId, tenantId);
    if (!article) throw new NotFoundError('Artículo no encontrado');
    await repo.linkTicket(articleId, ticketId, linkedBy);
  }

  // ── Procedimientos ────────────────────────────────────────────────────────

  async getProcedures(category, tenantId) { return repo.findProcedures(category, tenantId); }
  async getProcedureById(id, tenantId) {
    const p = await repo.findProcedureById(id, tenantId);
    if (!p) throw new NotFoundError('Procedimiento no encontrado');
    return p;
  }

  async createProcedure({ title, description, procedure_category, content_type, content_data, file_name }, user, tenantId) {
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
    }, tenantId);
  }

  async deactivateProcedure(id, user, tenantId) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    await repo.deactivateProcedure(id, tenantId);
  }

  // ── Solicitudes de procedimiento ──────────────────────────────────────────

  async getProcedureRequests(user, tenantId) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    return repo.findProcedureRequests(tenantId);
  }

  async createProcedureRequest({ query, description }, user, body, tenantId) {
    if (!query?.trim()) throw new ValidationError('Descripción requerida');
    await repo.createProcedureRequest({
      userId:    user ? user.id : null,
      userName:  (body.user_name  || user?.full_name || user?.nombre || user?.username || '').toString(),
      userEmail: (body.user_email || user?.email || '').toString(),
      query:     query.trim(),
      description: description || '',
    }, tenantId);
  }

  async updateProcedureRequestStatus(id, status, user, tenantId) {
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenError('Sin permiso');
    if (!VALID_PR_STATUS.includes(status)) throw new ValidationError('Estado inválido');
    await repo.updateProcedureRequestStatus(id, status, tenantId);
  }
}

module.exports = new KnowledgeService();

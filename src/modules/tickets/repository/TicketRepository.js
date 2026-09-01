'use strict';

const { Op } = require('sequelize');
const TenantBaseRepository = require('../../../repositories/TenantBaseRepository');
const { Ticket, TicketComment, TicketAttachment, Category } = require('../../../models');

class TicketRepository extends TenantBaseRepository {
  constructor(tenantId) {
    super(Ticket, tenantId);
  }

  async findPaginated({ where = {}, page = 1, limit = 25, search, dateFrom, dateTo } = {}) {
    const finalWhere = { ...where, deletedAt: null, ...this._scope() };

    if (search) {
      finalWhere[Op.or] = [
        { titulo:      { [Op.like]: `%${search}%` } },
        { descripcion: { [Op.like]: `%${search}%` } },
      ];
    }

    if (dateFrom || dateTo) {
      finalWhere.createdAt = {};
      if (dateFrom) finalWhere.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo)   finalWhere.createdAt[Op.lte]  = new Date(dateTo + 'T23:59:59');
    }

    return Ticket.findAndCountAll({
      where:   finalWhere,
      include: [{ model: Category, as: 'categoria', attributes: ['id', 'nombre', 'area'] }],
      order:   [['createdAt', 'DESC']],
      limit:   parseInt(limit),
      offset:  (parseInt(page) - 1) * parseInt(limit),
    });
  }

  async findByIdWithDetails(id) {
    return Ticket.findOne({
      where:   { id, deletedAt: null, ...this._scope() },
      include: [
        { model: Category,         as: 'categoria',   attributes: ['id', 'nombre', 'area'] },
        { model: TicketComment,    as: 'comentarios', order: [['createdAt', 'ASC']] },
        { model: TicketAttachment, as: 'adjuntos' },
      ],
    });
  }

  async countKPIs() {
    const base = { deletedAt: null, ...this._scope() };
    const [total, abiertos, en_progreso, pendientes, resueltos, p1, p2, vencidos] = await Promise.all([
      Ticket.count({ where: base }),
      Ticket.count({ where: { ...base, status: 'abierto' } }),
      Ticket.count({ where: { ...base, status: 'en_progreso' } }),
      Ticket.count({ where: { ...base, status: 'pendiente' } }),
      Ticket.count({ where: { ...base, status: 'resuelto' } }),
      Ticket.count({ where: { ...base, priority: 'P1', status: { [Op.notIn]: ['cerrado', 'resuelto'] } } }),
      Ticket.count({ where: { ...base, priority: 'P2', status: { [Op.notIn]: ['cerrado', 'resuelto'] } } }),
      Ticket.count({ where: { ...base, slaStatus: 'vencido', status: { [Op.notIn]: ['cerrado', 'resuelto'] } } }),
    ]);
    return { total, abiertos, en_progreso, pendientes, resueltos, p1, p2, vencidos };
  }

  async addComment({ ticketId, userId, contenido, tipo = 'comentario', metadata = null }) {
    return TicketComment.create({ ticketId, userId, contenido, tipo, metadata });
  }

  async addAttachment({ ticketId, userId, filename, original, mimetype, sizeBytes }) {
    return TicketAttachment.create({ ticketId, userId, filename, original, mimetype, sizeBytes });
  }

  async getCategories() {
    return Category.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] });
  }
}

module.exports = TicketRepository;

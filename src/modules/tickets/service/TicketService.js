'use strict';

const { SLAPolicy } = require('../../../models');
const TicketRepository = require('../repository/TicketRepository');
const { NotFoundError, ValidationError } = require('../../../utils/errors');
const { bus } = require('../../../core/events');
const { TicketPolicy } = require('../../../core/policies');

class TicketService {
  constructor(tenantId) {
    this.repo = new TicketRepository(tenantId);
  }

  async list({ status, priority, tipo, category_id, assigned_to, sla_status, search, page, limit, date_from, date_to } = {}) {
    const where = {};
    if (status)      where.status     = status;
    if (priority)    where.priority   = priority;
    if (tipo)        where.tipo       = tipo;
    if (category_id) where.categoryId = parseInt(category_id);
    if (assigned_to) where.assignedTo = assigned_to;
    if (sla_status)  where.slaStatus  = sla_status;

    return this.repo.findPaginated({ where, page, limit, search, dateFrom: date_from, dateTo: date_to });
  }

  async getById(id, pCtx = null) {
    const ticket = await this.repo.findByIdWithDetails(id);
    if (!ticket) throw new NotFoundError('Ticket no encontrado');
    if (pCtx) TicketPolicy.assertRead(pCtx, ticket);
    return ticket;
  }

  async getKPIs() {
    return this.repo.countKPIs();
  }

  async create({ titulo, descripcion, tipo, priority = 'P3', category_id, assigned_to, metadata, userId }, ctx = {}, pCtx = null) {
    if (pCtx) TicketPolicy.assertCreate(pCtx);
    if (!titulo) throw new ValidationError('El título es requerido');

    const slaDueAt = await this._calcularSlaDueAt(priority);

    const ticket = await this.repo.create({
      titulo,
      descripcion:  descripcion || null,
      tipo:         tipo || 'incidente',
      priority,
      categoryId:   category_id || null,
      assignedTo:   assigned_to || null,
      createdBy:    userId || null,
      slaDueAt,
      metadata:     metadata || null,
    });

    await this.repo.addComment({
      ticketId:  ticket.id,
      userId:    userId || null,
      contenido: `Ticket creado`,
      tipo:      'sistema',
    });

    await bus.emit('ticket.created', {
      ticket,
      tenantId:      this.repo.tenantId,
      userId,
      correlationId: ctx.correlationId,
      userEmail:     ctx.userEmail,
      userName:      ctx.userName,
      ip:            ctx.ip,
      userAgent:     ctx.userAgent,
    });

    return ticket;
  }

  async update(id, { status, priority, assigned_to, titulo, descripcion, category_id, metadata }, userId, ctx = {}, pCtx = null) {
    const ticket = await this.repo.findById(id);
    if (pCtx) TicketPolicy.assertUpdate(pCtx, ticket);
    const prev   = { status: ticket.status, priority: ticket.priority, assignedTo: ticket.assignedTo };

    if (status && status !== ticket.status) {
      await this._registrarCambioEstado(ticket.id, userId, ticket.status, status);
      if (status === 'resuelto') ticket.resolvedAt = new Date();
      if (status === 'cerrado')  ticket.closedAt   = new Date();
    }

    if (assigned_to && assigned_to !== ticket.assignedTo) {
      await this.repo.addComment({
        ticketId:  ticket.id,
        userId:    userId || null,
        contenido: `Ticket asignado a usuario ${assigned_to}`,
        tipo:      'asignacion',
        metadata:  { from: ticket.assignedTo, to: assigned_to },
      });
    }

    if (status)      ticket.status     = status;
    if (priority) {
      ticket.priority = priority;
      ticket.slaDueAt = await this._calcularSlaDueAt(priority);
    }
    if (assigned_to)               ticket.assignedTo  = assigned_to;
    if (titulo)                    ticket.titulo       = titulo;
    if (descripcion !== undefined)  ticket.descripcion  = descripcion;
    if (category_id !== undefined)  ticket.categoryId   = category_id;
    if (metadata)                  ticket.metadata     = metadata;

    await ticket.save();

    await bus.emit('ticket.updated', {
      ticket,
      prev,
      tenantId:      this.repo.tenantId,
      userId,
      correlationId: ctx.correlationId,
      userEmail:     ctx.userEmail,
      userName:      ctx.userName,
      ip:            ctx.ip,
      userAgent:     ctx.userAgent,
    });

    return ticket;
  }

  async softDelete(id, pCtx = null) {
    const ticket = await this.repo.findById(id);
    if (pCtx) TicketPolicy.assertDelete(pCtx, ticket);
    ticket.deletedAt = new Date();
    await ticket.save();
    return ticket;
  }

  async addComment(ticketId, { contenido }, userId, pCtx = null) {
    if (!contenido) throw new ValidationError('El contenido es requerido');
    const ticket = await this.repo.findById(ticketId);
    if (pCtx) TicketPolicy.assertAddComment(pCtx, ticket);
    return this.repo.addComment({ ticketId, userId, contenido, tipo: 'comentario' });
  }

  async addAttachment(ticketId, file, userId) {
    if (!file) throw new ValidationError('No se recibió archivo');
    await this.repo.findById(ticketId);
    return this.repo.addAttachment({
      ticketId,
      userId,
      filename:  file.filename,
      original:  file.originalname,
      mimetype:  file.mimetype,
      sizeBytes: file.size,
    });
  }

  async getCategories() {
    return this.repo.getCategories();
  }

  // ── Privados ─────────────────────────────────────────────────────────────

  async _calcularSlaDueAt(priority) {
    const policy = await SLAPolicy.findOne({ where: { prioridad: priority } });
    if (!policy) return null;
    return new Date(Date.now() + policy.tiempoResolucionH * 60 * 60 * 1000);
  }

  async _registrarCambioEstado(ticketId, userId, from, to) {
    await this.repo.addComment({
      ticketId,
      userId,
      contenido: `Estado cambiado de "${from}" a "${to}"`,
      tipo:      'cambio_estado',
      metadata:  { from, to },
    });
  }
}

module.exports = TicketService;

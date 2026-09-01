'use strict';

const { logAuditEvent } = require('../../../utils/audit');

module.exports = function registerAuditListener(bus) {
  bus.on('ticket.created', async ({ ticket, tenantId, userId, correlationId, ip, userAgent }) => {
    await logAuditEvent({
      userId,
      tenantId,
      correlationId,
      accion:    'create_ticket',
      recurso:   'ticket',
      recursoId: ticket.id,
      detalles:  { titulo: ticket.titulo, priority: ticket.priority, tipo: ticket.tipo },
      ip,
      userAgent,
    });
  });

  bus.on('ticket.updated', async ({ ticket, prev, tenantId, userId, correlationId, ip, userAgent }) => {
    await logAuditEvent({
      userId,
      tenantId,
      correlationId,
      accion:    'update_ticket',
      recurso:   'ticket',
      recursoId: ticket.id,
      detalles:  { before: prev, after: { status: ticket.status, priority: ticket.priority, assignedTo: ticket.assignedTo } },
      ip,
      userAgent,
    });
  });

  bus.on('ticket.deleted', async ({ ticketId, tenantId, userId, correlationId }) => {
    await logAuditEvent({
      userId,
      tenantId,
      correlationId,
      accion:    'delete_ticket',
      recurso:   'ticket',
      recursoId: ticketId,
      detalles:  null,
    });
  });
};

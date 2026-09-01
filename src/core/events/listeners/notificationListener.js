'use strict';

const { enqueueEmail } = require('../../../queues/index');
const logger = require('../../../utils/logger');

module.exports = function registerNotificationListener(bus) {
  bus.on('ticket.created', async ({ ticket, userEmail, userName }) => {
    if (!userEmail) return;
    await enqueueEmail({
      to:       userEmail,
      subject:  `Ticket creado: ${ticket.titulo}`,
      template: 'ticket-creado',
      vars:     { nombre: userName, ticketId: ticket.id, titulo: ticket.titulo, priority: ticket.priority },
    });
    logger.debug(`[notificationListener] Email creación enviado a ${userEmail}`);
  });

  bus.on('ticket.updated', async ({ ticket, prev, userEmail, userName }) => {
    if (!userEmail || !prev || ticket.status === prev.status) return;
    await enqueueEmail({
      to:       userEmail,
      subject:  `Tu ticket fue actualizado: ${ticket.titulo}`,
      template: 'ticket-actualizado',
      vars:     { nombre: userName, ticketId: ticket.id, titulo: ticket.titulo, statusAntes: prev.status, statusAhora: ticket.status },
    });
    logger.debug(`[notificationListener] Email actualización enviado a ${userEmail}`);
  });

  bus.on('ticket.sla_breach', async ({ ticket, agentEmail, agentName }) => {
    if (!agentEmail) return;
    await enqueueEmail({
      to:       agentEmail,
      subject:  `SLA VENCIDO: ${ticket.titulo}`,
      template: 'sla-riesgo',
      vars:     { nombre: agentName, ticketId: ticket.id, titulo: ticket.titulo, estado: 'vencido', dueAt: ticket.slaDueAt },
    });
  });
};

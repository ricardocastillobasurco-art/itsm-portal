'use strict';

const { classify }   = require('../../ai/TicketClassifier');
const { Ticket }     = require('../../../models');
const logger         = require('../../../utils/logger');

module.exports = function registerAiListener(bus) {
  bus.on('ticket.created', async ({ ticket }) => {
    if (!process.env.GROQ_API_KEY) return;

    const result = await classify(ticket.titulo, ticket.descripcion);
    if (!result) return;

    // Aplica sugerencias de IA solo si el campo no fue indicado explícitamente
    const updates = {};
    if (!ticket.tipo     || ticket.tipo     === 'incidente') updates.tipo     = result.tipo;
    if (!ticket.priority || ticket.priority === 'P3')        updates.priority = result.priority;
    if (result.resumen)       updates.aiSummary    = result.resumen;
    if (result.palabras_clave?.length) updates.aiKeywords = result.palabras_clave.join(',');

    if (Object.keys(updates).length) {
      await Ticket.update(updates, { where: { id: ticket.id } });
      logger.info('AI clasificó ticket', { ticketId: ticket.id, classification: result });
    }
  });
};

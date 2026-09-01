'use strict';

const { enqueueSla } = require('../../../queues/index');
const logger = require('../../../utils/logger');

module.exports = function registerSlaListener(bus) {
  bus.on('ticket.created', async ({ ticket }) => {
    if (!ticket?.id || !ticket?.slaDueAt) return;
    await enqueueSla(ticket.id);
    logger.debug(`[slaListener] SLA encolado para ticket ${ticket.id}`);
  });
};

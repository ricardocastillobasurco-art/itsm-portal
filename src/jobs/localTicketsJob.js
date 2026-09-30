'use strict';

// Gestión local: cierra automáticamente los tickets resueltos sin respuesta del
// usuario (Automatizaciones → "Cierre automático", por defecto 3 días). Cada hora.

const { autoCloseAll } = require('../services/localTickets/LocalTicketService');
const logger = require('../utils/logger');

let _timer = null;

function startLocalTicketsJob() {
  if (_timer) return;
  const run = () => autoCloseAll()
    .then(n => { if (n) logger.info(`[local-tickets] ${n} ticket(s) cerrados automáticamente`); })
    .catch(e => logger.warn(`[local-tickets] cierre automático: ${e.message}`));
  _timer = setInterval(run, 60 * 60 * 1000);
  setTimeout(run, 5 * 60 * 1000); // primera pasada 5 min después de arrancar
  logger.info('[local-tickets] Job de cierre automático registrado — cada hora');
}

module.exports = { startLocalTicketsJob };

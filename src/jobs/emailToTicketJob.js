'use strict';

// Revisa periódicamente los buzones de soporte de cada tenant (correo a ticket).
// Intervalo: EMAIL_TO_TICKET_INTERVAL_SEC (por defecto 120 s, mínimo 30 s).

const { runAll } = require('../services/emailToTicket');
const logger = require('../utils/logger');

let _timer = null;

function startEmailToTicketJob(io) {
  if (_timer) return;
  const sec = Math.max(30, parseInt(process.env.EMAIL_TO_TICKET_INTERVAL_SEC, 10) || 120);
  _timer = setInterval(() => runAll({ io }).catch(e => logger.warn(`[email-to-ticket] ${e.message}`)), sec * 1000);
  logger.info(`[email-to-ticket] Job registrado — cada ${sec}s`);
}

module.exports = { startEmailToTicketJob };

'use strict';

// Prueba gratuita: recordatorios y paso automático a Gratis (TrialService). Cada hora.

const { run } = require('../services/TrialService');
const logger = require('../utils/logger');

let _timer = null;

function startTrialJob() {
  if (_timer) return;
  const tick = () => run().catch(e => logger.warn(`[prueba] ${e.message}`));
  _timer = setInterval(tick, 60 * 60 * 1000);
  setTimeout(tick, 3 * 60 * 1000);   // primera pasada 3 min después de arrancar
  logger.info('[prueba] Job de pruebas gratuitas registrado — cada hora');
}

module.exports = { startTrialJob };

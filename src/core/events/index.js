'use strict';

const bus    = require('./EventBus');
const logger = require('../../utils/logger');

function registerListeners() {
  require('./listeners/slaListener')(bus);
  require('./listeners/notificationListener')(bus);
  require('./listeners/auditListener')(bus);
  require('./listeners/jiraListener')(bus);
  require('./listeners/aiListener')(bus);
  require('./listeners/metricsListener')(bus);
  logger.info('[EventBus] Listeners registrados ✓');
}

module.exports = { bus, registerListeners };

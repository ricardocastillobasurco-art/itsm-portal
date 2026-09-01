'use strict';

const FeatureFlagService = require('../src/services/FeatureFlagService');
const logger             = require('../utils/logger');

// Features habilitados por defecto cuando no hay registro en BD
const DEFAULTS = {
  sla_automatico:     true,
  encuestas:          true,
  cmdb:               true,
  kb_publico:         false,
  jira:               false,
  microsoft_teams:    false,
  intune:             false,
  outlook_sync:       false,
  reportes_avanzados: false,
  api_externa:        false,
};

module.exports = async function tenantFeatures(req, res, next) {
  res.locals.features     = { ...DEFAULTS };
  res.locals.featuresJson = JSON.stringify({ ...DEFAULTS });
  try {
    const tenantId = req.tenant?.id ?? req.user?.tenant_id;
    if (tenantId) {
      const map = await FeatureFlagService.getAll(tenantId);
      for (const [key, val] of Object.entries(map)) {
        res.locals.features[key] = val.enabled ?? false;
      }
      res.locals.featuresJson = JSON.stringify(res.locals.features);
    }
  } catch (err) {
    logger.warn('[tenantFeatures] Error cargando features:', err.message);
  }
  next();
};

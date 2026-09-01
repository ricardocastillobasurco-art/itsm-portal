'use strict';

const ApiResponse  = require('./response');
const errors       = require('./errors');
const logger       = require('./logger');
const audit        = require('./audit');
const { tenantWhere, addTenant, tenantId } = require('./tenantScope');
const { hasFeature, requireFeature, getFeatureMap } = require('./featureFlags');

module.exports = { ApiResponse, ...errors, logger, ...audit, tenantWhere, addTenant, tenantId, hasFeature, requireFeature, getFeatureMap };

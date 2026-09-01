'use strict';

/**
 * Feature flags per tenant — stored in tenant.settings.features.
 *
 * Configure via PUT /api/tenant-graph/config (extend to a dedicated endpoint)
 * or directly in the tenants.settings JSON column:
 *   { "features": { "itsm": true, "cmdb": true, "knowledge": false } }
 *
 * Usage in a route:
 *   const { requireFeature, hasFeature } = require('../src/utils/featureFlags');
 *
 *   // As middleware:
 *   router.get('/tickets', authenticateToken, requireFeature('itsm'), handler);
 *
 *   // As a boolean check inside a handler:
 *   if (hasFeature(req, 'cmdb')) { ... }
 */

// Default features enabled for ALL tenants (unless explicitly disabled)
const DEFAULTS = {
  itsm:          true,
  'service-desk': true,
  knowledge:     true,
  cmdb:          false,  // opt-in
  csi:           false,  // opt-in
  licenses:      false,  // opt-in
  billing:       false,  // reserved
};

/**
 * Returns true if the feature is enabled for the tenant in req.
 * Falls back to DEFAULTS when not explicitly configured.
 */
function hasFeature(req, feature) {
  const features = req?.tenant?.settings?.features;
  if (features && Object.prototype.hasOwnProperty.call(features, feature)) {
    return features[feature] === true;
  }
  return DEFAULTS[feature] ?? false;
}

/**
 * Middleware that blocks the request with 403 if the feature is not enabled.
 */
function requireFeature(feature) {
  return (req, res, next) => {
    if (!hasFeature(req, feature)) {
      return res.status(403).json({
        success: false,
        error:   `La funcionalidad "${feature}" no está habilitada para este tenant.`,
        code:    'FEATURE_DISABLED',
      });
    }
    next();
  };
}

/**
 * Returns the full feature map for a tenant (merged with defaults).
 * Useful for exposing to the frontend via an /api/features endpoint.
 */
function getFeatureMap(req) {
  const overrides = req?.tenant?.settings?.features || {};
  return { ...DEFAULTS, ...overrides };
}

module.exports = { hasFeature, requireFeature, getFeatureMap, DEFAULTS };

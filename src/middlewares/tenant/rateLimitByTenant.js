'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Per-tenant rate limits based on subscription plan.
 * Limits are per-IP within a tenant window (standard behavior).
 * enterprise/professional get higher limits or bypass entirely.
 *
 * Usage:
 *   router.use('/api/', rateLimitByTenant());
 */

const PLAN_LIMITS = {
  trial:        { max: 100,  windowMs: 15 * 60 * 1000 },
  starter:      { max: 300,  windowMs: 15 * 60 * 1000 },
  professional: { max: 1000, windowMs: 15 * 60 * 1000 },
  enterprise:   { max: 0,    windowMs: 15 * 60 * 1000 }, // 0 = unlimited
};

// Cache limiters per plan to avoid creating a new one per request
const _limiters = new Map();

function getLimiter(plan) {
  if (_limiters.has(plan)) return _limiters.get(plan);

  const { max, windowMs } = PLAN_LIMITS[plan] || PLAN_LIMITS.trial;

  // max:0 → skip rate limiting for enterprise
  if (max === 0) {
    const bypass = (req, res, next) => next();
    _limiters.set(plan, bypass);
    return bypass;
  }

  const limiter = rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => {
      // Key by tenant + IP so tenants don't share quota
      const tenantId = req.tenant?.id ?? 'default';
      return `${tenantId}:${req.ip}`;
    },
    message: {
      success: false,
      error:   `Límite de peticiones alcanzado para el plan "${plan}". Intenta nuevamente más tarde.`,
    },
    standardHeaders: true,
    legacyHeaders:   false,
  });

  _limiters.set(plan, limiter);
  return limiter;
}

/**
 * Express middleware factory.
 * Must be mounted AFTER tenantMiddleware so req.tenant is populated.
 */
function rateLimitByTenant() {
  return (req, res, next) => {
    const plan = req.tenant?.plan || 'trial';
    const limiter = getLimiter(plan);
    return limiter(req, res, next);
  };
}

module.exports = rateLimitByTenant;

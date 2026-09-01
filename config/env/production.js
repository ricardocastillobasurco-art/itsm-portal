'use strict';

module.exports = {
  logLevel:         'info',
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== undefined
    ? process.env.RATE_LIMIT_ENABLED !== 'false'
    : true,
  sqlLogging:       false,
  corsOrigins:      (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  sessionSecure:    true,
  redisHost:        process.env.REDIS_HOST,
  redisPort:        parseInt(process.env.REDIS_PORT) || 6379,
  tenantCacheTtlMs: 10 * 60 * 1000,
};

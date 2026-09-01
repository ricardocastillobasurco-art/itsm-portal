'use strict';

module.exports = {
  logLevel:         'warn',
  rateLimitEnabled: false,
  sqlLogging:       false,
  corsOrigins:      ['http://localhost:3000'],
  sessionSecure:    false,
  redisHost:        process.env.REDIS_HOST || 'localhost',
  redisPort:        parseInt(process.env.REDIS_PORT) || 6379,
  tenantCacheTtlMs: 1000, // 1 s — faster cache expiry in tests
};

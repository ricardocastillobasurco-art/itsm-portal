'use strict';

module.exports = {
  logLevel:         'debug',
  rateLimitEnabled: false,
  sqlLogging:       true,
  corsOrigins:      ['http://localhost:3000', 'http://localhost:3001'],
  sessionSecure:    false,
  redisHost:        process.env.REDIS_HOST || 'localhost',
  redisPort:        parseInt(process.env.REDIS_PORT) || 6379,
  tenantCacheTtlMs: 5 * 60 * 1000,
};

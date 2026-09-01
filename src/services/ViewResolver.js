'use strict';

const redis  = require('../config/redis');
const logger = require('../utils/logger');

function _model() {
  return require('../models').TenantViewOverride;
}

const TTL = 600; // 10 minutos

function _key(tenantId) {
  return `view:override:${tenantId}`;
}

const ViewResolver = {
  /**
   * Devuelve el override de branding del tenant, o null si no tiene.
   * Resultado cacheado en Redis 10 minutos.
   */
  async getOverride(tenantId) {
    try {
      const cached = await redis.get(_key(tenantId));
      if (cached !== null) return JSON.parse(cached);

      const record = await _model().findOne({ where: { tenantId } });
      const data   = record ? record.toJSON() : null;

      await redis.setex(_key(tenantId), TTL, JSON.stringify(data));
      return data;
    } catch (err) {
      logger.warn(`[ViewResolver] getOverride error (tenant ${tenantId}):`, err.message);
      return null;
    }
  },

  /**
   * Guarda o actualiza el override de branding. Invalida cache.
   */
  async set(tenantId, data) {
    const TenantViewOverride = _model();
    const [record] = await TenantViewOverride.upsert({ tenantId, ...data }, { returning: true });
    await ViewResolver.invalidate(tenantId);
    return record;
  },

  /**
   * Invalida el cache del override de un tenant.
   */
  async invalidate(tenantId) {
    try {
      await redis.del(_key(tenantId));
    } catch (err) {
      logger.warn('[ViewResolver] invalidate error:', err.message);
    }
  },
};

module.exports = ViewResolver;

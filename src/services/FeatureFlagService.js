'use strict';

const redis  = require('../config/redis');
const logger = require('../utils/logger');

// Modelo cargado lazy para evitar dependencias circulares en el boot
function _model() {
  return require('../models').TenantFeature;
}

const TTL = 300; // 5 minutos

function _key(tenantId, featureName) {
  return `ff:${tenantId}:${featureName}`;
}

function _allKey(tenantId) {
  return `ff:all:${tenantId}`;
}

const FeatureFlagService = {
  /**
   * Verifica si un feature está habilitado para un tenant.
   * Resultado cacheado en Redis 5 minutos.
   */
  async isEnabled(tenantId, featureName) {
    try {
      const cached = await redis.get(_key(tenantId, featureName));
      if (cached !== null) return cached === '1';

      const record = await _model().findOne({ where: { tenantId, name: featureName } });
      const enabled = record?.enabled ?? false;

      await redis.setex(_key(tenantId, featureName), TTL, enabled ? '1' : '0');
      return enabled;
    } catch (err) {
      logger.warn(`[FeatureFlagService] isEnabled error (${featureName}):`, err.message);
      return false;
    }
  },

  /**
   * Devuelve todos los features de un tenant como { featureName: { enabled, config } }.
   */
  async getAll(tenantId) {
    try {
      const cached = await redis.get(_allKey(tenantId));
      if (cached) return JSON.parse(cached);

      const records = await _model().findAll({ where: { tenantId } });
      const map = Object.fromEntries(
        records.map(r => [r.name, { enabled: r.enabled, config: r.config }])
      );

      await redis.setex(_allKey(tenantId), TTL, JSON.stringify(map));
      return map;
    } catch (err) {
      logger.warn(`[FeatureFlagService] getAll error (tenant ${tenantId}):`, err.message);
      return {};
    }
  },

  /**
   * Activa o desactiva un feature para un tenant. Invalida cache.
   */
  async set(tenantId, featureName, enabled, config = null) {
    const TenantFeature = _model();
    const [record] = await TenantFeature.upsert(
      { tenantId, name: featureName, enabled, config },
      { returning: true }
    );
    await FeatureFlagService.invalidate(tenantId, featureName);
    return record;
  },

  /**
   * Elimina un feature de un tenant. Invalida cache.
   */
  async remove(tenantId, featureName) {
    await _model().destroy({ where: { tenantId, name: featureName } });
    await FeatureFlagService.invalidate(tenantId, featureName);
  },

  /**
   * Invalida cache de un feature o de todos los features de un tenant.
   */
  async invalidate(tenantId, featureName = null) {
    try {
      if (featureName) await redis.del(_key(tenantId, featureName));
      await redis.del(_allKey(tenantId));
    } catch (err) {
      logger.warn('[FeatureFlagService] invalidate error:', err.message);
    }
  },
};

module.exports = FeatureFlagService;

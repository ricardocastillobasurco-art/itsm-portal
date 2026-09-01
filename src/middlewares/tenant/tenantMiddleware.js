'use strict';

const tenantRepo         = require('../../repositories/platform/TenantRepository');
const FeatureFlagService = require('../../services/FeatureFlagService');
const ViewResolver       = require('../../services/ViewResolver');

/**
 * Resolves the current tenant from the request using this priority order:
 *  1. X-Tenant-ID header  → DB lookup by id
 *  2. Subdomain           → DB lookup by slug  (e.g. cliente1.miapp.com)
 *  3. req.user.tenant_id  → set by authenticateToken after this middleware runs
 *                           (auth middleware overwrites req.tenant directly)
 *  4. DEFAULT_TENANT fallback — always succeeds, never breaks existing routes
 *
 * Sets req.tenant = { id, slug, name, plan } on every request.
 * Authenticated routes get their tenant overwritten by authenticateToken
 * which has the user's real tenant_id from the DB.
 */
async function tenantMiddleware(req, res, next) {
  try {
    const raw    = await _resolve(req);
    const tenant = _normalize(raw);

    // Enriquecer con features reales de BD/Redis (nunca bloquea si falla)
    if (tenant.id) {
      const [features, branding] = await Promise.allSettled([
        FeatureFlagService.getAll(tenant.id),
        ViewResolver.getOverride(tenant.id),
      ]);
      tenant.features = features.status === 'fulfilled' ? features.value : {};
      tenant.branding = branding.status === 'fulfilled' ? branding.value : null;
    }

    // Bloquear tenants suspendidos — excepto rutas de health y auth
    if (tenant.id && !tenant.active && !tenant.is_active) {
      const path = req.path || '';
      const isPublic = path.startsWith('/health') || path.startsWith('/api/auth') || path === '/metrics';
      if (!isPublic) {
        return res.status(403).json({
          success: false,
          error:   'Cuenta suspendida. Contacta a soporte en soporte@tudominio.com',
          code:    'TENANT_SUSPENDED',
        });
      }
    }

    req.tenant = tenant;
    if (res.locals) res.locals.tenant = tenant;
    next();
  } catch {
    req.tenant = _normalize(tenantRepo.default());
    if (res.locals) res.locals.tenant = req.tenant;
    next();
  }
}

function _normalize(tenant) {
  if (!tenant) return tenant;
  return {
    ...tenant,
    active:   tenant.is_active !== undefined ? Boolean(tenant.is_active) : true,
    timezone: tenant.timezone || (tenant.settings?.timezone) || 'America/Lima',
    features: tenant.settings?.features || {},
    config:   tenant.settings           || {},
  };
}

async function _resolve(req) {
  // 1. Explicit header (internal services / Postman)
  const headerId = req.headers['x-tenant-id'];
  if (headerId) {
    const tenant = await tenantRepo.findById(parseInt(headerId)).catch(() => null);
    if (tenant) return _normalize(tenant);
  }

  // 2. Subdomain — skip localhost / raw IPs / www
  const host  = (req.hostname || '').toLowerCase();
  const parts = host.split('.');
  if (parts.length >= 3 && parts[0] !== 'www') {
    const tenant = await tenantRepo.findBySlug(parts[0]).catch(() => null);
    if (tenant) return _normalize(tenant);
  }

  // 3. Default (authenticated routes get overwritten by authenticateToken)
  return _normalize(tenantRepo.default());
}

module.exports = tenantMiddleware;

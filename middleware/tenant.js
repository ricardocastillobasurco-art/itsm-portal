'use strict';

const PRIMARY_TENANT_ID = 1;

/**
 * Inyecta req.tenantId y req.isPrimaryTenant en todos los requests autenticados.
 * Debe montarse después de authenticateToken en server.js.
 */
function tenantMiddleware(req, res, next) {
  req.tenantId       = parseInt(req.user?.tenant_id || PRIMARY_TENANT_ID);
  req.isPrimaryTenant = req.tenantId === PRIMARY_TENANT_ID;
  next();
}

module.exports = tenantMiddleware;
module.exports.PRIMARY_TENANT_ID = PRIMARY_TENANT_ID;

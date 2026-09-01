'use strict';

const PRIMARY_TENANT_ID = 1;

function tenantMiddleware(req, res, next) {
  req.tenantId        = parseInt(req.user?.tenant_id || PRIMARY_TENANT_ID);
  req.isPrimaryTenant = req.tenantId === PRIMARY_TENANT_ID;
  next();
}

module.exports = { tenantMiddleware, PRIMARY_TENANT_ID };

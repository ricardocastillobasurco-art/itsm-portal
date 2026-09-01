'use strict';

const DEFAULT_TENANT_ID = 1;

/**
 * Returns { tenant_id } for Sequelize where clauses.
 * When tenant is the default (id=1) we still filter so existing data
 * rows backfilled to tenant 1 are correctly scoped.
 */
function tenantWhere(req) {
    const id = req?.tenant?.id ?? DEFAULT_TENANT_ID;
    return { tenant_id: id };
}

/**
 * Merges tenant_id into a Sequelize findAll/findOne options object.
 * Safe to call even when `options.where` is undefined.
 */
function addTenant(options = {}, req) {
    return {
        ...options,
        where: { ...options.where, ...tenantWhere(req) },
    };
}

/**
 * Returns tenant_id as a raw value (for INSERT statements).
 */
function tenantId(req) {
    return req?.tenant?.id ?? DEFAULT_TENANT_ID;
}

module.exports = { tenantWhere, addTenant, tenantId };

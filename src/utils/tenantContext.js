'use strict';

// Contexto del tenant de la petición en curso (AsyncLocalStorage). Lo fija
// authenticateToken y lo leen capas que no reciben `req` —por ejemplo los
// guardas de integraciones— para saber a qué cliente pertenece la operación.
// Fuera de una petición (cron, arranque) no hay contexto: currentTenantId() = null.

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function setTenantContext(ctx) {
    als.enterWith({ ...ctx });
}

function currentTenantId() {
    const id = als.getStore()?.tenantId;
    return id === undefined || id === null ? null : Number(id);
}

function runWithTenant(tenantId, fn) {
    return als.run({ tenantId }, fn);
}

module.exports = { setTenantContext, currentTenantId, runWithTenant };

'use strict';

/**
 * Integraciones del nuevo tenant.
 * Las credenciales sensibles deben ir en .env, no aquí.
 * Usar variables de entorno con prefijo del cliente: PETROTAL_JIRA_TOKEN, etc.
 */
module.exports = {

    jira: {
        enabled:    false,
        host:       process.env.NUEVO_CLIENTE_JIRA_HOST  || null,
        email:      process.env.NUEVO_CLIENTE_JIRA_EMAIL || null,
        token:      process.env.NUEVO_CLIENTE_JIRA_TOKEN || null,
        projectKey: process.env.NUEVO_CLIENTE_JIRA_PROJECT || null,
    },

    microsoft: {
        enabled:      false,
        tenantId:     process.env.NUEVO_CLIENTE_MS_TENANT_ID     || null,
        clientId:     process.env.NUEVO_CLIENTE_MS_CLIENT_ID     || null,
        clientSecret: process.env.NUEVO_CLIENTE_MS_CLIENT_SECRET || null,
        allowedDomain:null,
    },

    outlook: { enabled: false },
    intune:  { enabled: false },
    teams:   { enabled: false },

};

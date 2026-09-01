'use strict';

/**
 * Integraciones del tenant prueba
 * Credenciales sensibles se leen de .env — nunca hardcodear tokens aquí.
 * Prefijo de variables de entorno: PRUEBA_
 */
module.exports = {

    jira: {
        enabled:    false,
        host:       process.env.PRUEBA_JIRA_HOST    || null,
        email:      process.env.PRUEBA_JIRA_EMAIL   || null,
        token:      process.env.PRUEBA_JIRA_TOKEN   || null,
        projectKey: process.env.PRUEBA_JIRA_PROJECT || null,
    },

    microsoft: {
        enabled:      false,
        tenantId:     process.env.PRUEBA_MS_TENANT_ID     || null,
        clientId:     process.env.PRUEBA_MS_CLIENT_ID     || null,
        clientSecret: process.env.PRUEBA_MS_CLIENT_SECRET || null,
        allowedDomain:null,
    },

    outlook: { enabled: false },
    intune:  { enabled: false },
    teams:   { enabled: false },

};

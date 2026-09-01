'use strict';

/**
 * Integraciones del tenant Petrotal
 * Credenciales sensibles se leen de .env — nunca hardcodear tokens aquí.
 * Prefijo de variables de entorno: PETROTAL_
 */
module.exports = {

    jira: {
        enabled:    false,
        host:       process.env.PETROTAL_JIRA_HOST    || null,
        email:      process.env.PETROTAL_JIRA_EMAIL   || null,
        token:      process.env.PETROTAL_JIRA_TOKEN   || null,
        projectKey: process.env.PETROTAL_JIRA_PROJECT || null,
    },

    microsoft: {
        enabled:      false,
        tenantId:     process.env.PETROTAL_MS_TENANT_ID     || null,
        clientId:     process.env.PETROTAL_MS_CLIENT_ID     || null,
        clientSecret: process.env.PETROTAL_MS_CLIENT_SECRET || null,
        allowedDomain:null,
    },

    outlook: { enabled: false },
    intune:  { enabled: false },
    teams:   { enabled: false },

};

'use strict';

/**
 * Integraciones del tenant datatec
 * Credenciales sensibles se leen de .env — nunca hardcodear tokens aquí.
 * Prefijo de variables de entorno: DATATEC_
 */
module.exports = {

    jira: {
        enabled:    false,
        host:       process.env.DATATEC_JIRA_HOST    || null,
        email:      process.env.DATATEC_JIRA_EMAIL   || null,
        token:      process.env.DATATEC_JIRA_TOKEN   || null,
        projectKey: process.env.DATATEC_JIRA_PROJECT || null,
    },

    microsoft: {
        enabled:      false,
        tenantId:     process.env.DATATEC_MS_TENANT_ID     || null,
        clientId:     process.env.DATATEC_MS_CLIENT_ID     || null,
        clientSecret: process.env.DATATEC_MS_CLIENT_SECRET || null,
        allowedDomain:null,
    },

    outlook: { enabled: false },
    intune:  { enabled: false },
    teams:   { enabled: false },

};

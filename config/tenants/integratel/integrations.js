'use strict';

/**
 * Integraciones del tenant Integratel
 * Credenciales sensibles se leen de .env — nunca hardcodear tokens aquí.
 */
module.exports = {

    jira: {
        enabled:    true,
        host:       process.env.JIRA_HOST       || 'https://integratelperu.atlassian.net',
        email:      process.env.JIRA_EMAIL      || '',
        token:      process.env.JIRA_API_TOKEN  || '',
        projectKey: process.env.JIRA_PROJECT    || 'IT',
    },

    microsoft: {
        enabled:      true,
        tenantId:     process.env.MS_TENANT_ID     || '',
        clientId:     process.env.MS_CLIENT_ID     || '',
        clientSecret: process.env.MS_CLIENT_SECRET || '',
        allowedDomain:'integratel.com.pe',
    },

    outlook: {
        enabled:       true,
        smtpHost:      process.env.SMTP_HOST || 'smtp.office365.com',
        smtpPort:      process.env.SMTP_PORT || '587',
        smtpUser:      process.env.SMTP_USER || '',
        smtpPass:      process.env.SMTP_PASS || '',
        sharedMailbox: process.env.SMTP_USER || '',
    },

    intune: { enabled: true },
    teams:  { enabled: true },

};

'use strict';

let msal, nodeFetch;
try {
    msal      = require('@azure/msal-node');
    nodeFetch = (...a) => import('node-fetch').then(m => m.default(...a));
} catch { /* optional dep — routes guard against null */ }

class GraphService {
    constructor({ clientId, tenantId, clientSecret, mailbox }) {
        this.clientId     = clientId;
        this.tenantId     = tenantId;
        this.clientSecret = clientSecret;
        this.mailbox      = mailbox;
    }

    static fromTenant(tenant) {
        const g = tenant?.settings?.graph || {};
        return new GraphService({
            clientId:     g.clientId     || process.env.MS_CLIENT_ID1,
            tenantId:     g.tenantId     || process.env.MS_TENANT_ID1,
            clientSecret: g.clientSecret || process.env.MS_CLIENT_SECRET1,
            mailbox:      g.mailbox      || process.env.MAIL_SENDER,
        });
    }

    isConfigured() {
        return !!(this.clientId && this.tenantId && this.clientSecret && this.mailbox);
    }

    async getToken() {
        if (!msal) throw new Error('Dependencia no instalada: @azure/msal-node');
        if (!this.isConfigured())
            throw new Error('Graph no configurado para este tenant (clientId/tenantId/clientSecret/mailbox)');

        const cca = new msal.ConfidentialClientApplication({
            auth: {
                clientId:     this.clientId,
                authority:    `https://login.microsoftonline.com/${this.tenantId}`,
                clientSecret: this.clientSecret,
            },
        });
        const r = await cca.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default'],
        });
        if (!r?.accessToken) throw new Error('No se pudo obtener token de Azure AD');
        return r.accessToken;
    }

    async get(token, url) {
        const fetch = nodeFetch || ((...a) => import('node-fetch').then(m => m.default(...a)));
        const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
        return res.json();
    }

    configSummary() {
        return {
            clientId:  this.clientId  ? `${this.clientId.slice(0,8)}…` : null,
            tenantId:  this.tenantId  ? `${this.tenantId.slice(0,8)}…` : null,
            mailbox:   this.mailbox   || null,
            configured: this.isConfigured(),
        };
    }
}

module.exports = GraphService;

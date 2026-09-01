'use strict';

/**
 * IntegrationConfigService
 *
 * Lee la config de una integración para un tenant específico.
 * Prioridad: TenantFeature.config → process.env (fallback global)
 *
 * Esto permite que cada cliente tenga su propia instancia de Jira/Teams/etc.
 * sin romper el comportamiento actual (si no hay config de tenant, usa .env).
 */

const FeatureFlagService = require('./FeatureFlagService');
const logger = require('../utils/logger');

// Valores por defecto desde .env para cada integración
const ENV_DEFAULTS = {
    jira: {
        base_url:    () => process.env.JIRA_HOST      || 'https://integratelperu.atlassian.net',
        username:    () => process.env.JIRA_EMAIL     || '',
        api_token:   () => process.env.JIRA_API_TOKEN || '',
        project_key: () => process.env.JIRA_PROJECT   || 'IT',
    },
    microsoft_teams: {
        tenant_id:     () => process.env.MS_TENANT_ID     || '',
        client_id:     () => process.env.MS_CLIENT_ID     || '',
        client_secret: () => process.env.MS_CLIENT_SECRET || '',
        webhook_url:   () => '',
    },
    intune: {
        tenant_id:     () => process.env.MS_TENANT_ID     || '',
        client_id:     () => process.env.MS_CLIENT_ID     || '',
        client_secret: () => process.env.MS_CLIENT_SECRET || '',
    },
    outlook_sync: {
        tenant_id:     () => process.env.MS_TENANT_ID  || '',
        client_id:     () => process.env.MS_CLIENT_ID  || '',
        client_secret: () => process.env.MS_CLIENT_SECRET || '',
        shared_mailbox: () => process.env.SMTP_USER    || '',
        smtp_host:     () => process.env.SMTP_HOST     || 'smtp.office365.com',
        smtp_port:     () => process.env.SMTP_PORT     || '587',
        smtp_user:     () => process.env.SMTP_USER     || '',
        smtp_pass:     () => process.env.SMTP_PASS     || '',
    },
    api_externa: {
        base_url:       () => '',
        api_key:        () => process.env.GROQ_API_KEY || '',
        webhook_secret: () => '',
    },
};

// Módulos del sistema que usa cada integración
const INTEGRATION_MODULES = {
    jira: [
        { name: 'Gestión de Incidencias',     icon: 'bi-ticket-fill',      color: '#dc2626' },
        { name: 'Requerimientos de Servicio', icon: 'bi-gear-fill',         color: '#7c3aed' },
        { name: 'Reportes ITSM',              icon: 'bi-graph-up-arrow',    color: '#2563eb' },
        { name: 'Gestión de Cambios',         icon: 'bi-arrow-left-right',  color: '#0891b2' },
    ],
    microsoft_teams: [
        { name: 'Notificaciones',             icon: 'bi-bell-fill',         color: '#7c3aed' },
        { name: 'Alertas de SLA',             icon: 'bi-clock-fill',        color: '#d97706' },
        { name: 'Escalamientos',              icon: 'bi-arrow-up-right-circle-fill', color: '#dc2626' },
    ],
    intune: [
        { name: 'Gestión de Dispositivos',    icon: 'bi-laptop-fill',       color: '#059669' },
        { name: 'Licencias de Software',      icon: 'bi-key-fill',          color: '#0891b2' },
        { name: 'Cola de Impresión',          icon: 'bi-printer-fill',      color: '#7c3aed' },
    ],
    outlook_sync: [
        { name: 'Notificaciones por Email',   icon: 'bi-envelope-fill',     color: '#d97706' },
        { name: 'Portal de Autogestión',      icon: 'bi-person-fill',       color: '#2563eb' },
        { name: 'Alertas de Tickets',         icon: 'bi-chat-dots-fill',    color: '#059669' },
    ],
    api_externa: [
        { name: 'Chatbot IA',                 icon: 'bi-robot',             color: '#7c3aed' },
        { name: 'Webhooks Personalizados',    icon: 'bi-arrow-repeat',      color: '#dc2626' },
    ],
};

const IntegrationConfigService = {
    INTEGRATION_MODULES,

    /**
     * Obtiene la config efectiva de una integración para un tenant.
     * Mezcla: tenant_config || env_default
     */
    async get(tenantId, integrationName) {
        const envDefaults = ENV_DEFAULTS[integrationName];
        if (!envDefaults) return {};

        try {
            if (tenantId) {
                const features = await FeatureFlagService.getAll(tenantId);
                const tenantCfg = features[integrationName]?.config || {};
                const result = {};
                for (const [key, defaultFn] of Object.entries(envDefaults)) {
                    result[key] = (tenantCfg[key] && tenantCfg[key] !== '') ? tenantCfg[key] : defaultFn();
                }
                return result;
            }
        } catch (err) {
            logger.warn(`[IntegrationConfig] get error (${integrationName}):`, err.message);
        }

        // Fallback: solo valores de .env
        const result = {};
        for (const [key, fn] of Object.entries(envDefaults)) result[key] = fn();
        return result;
    },

    /**
     * Devuelve el estado completo de todas las integraciones para un tenant.
     * Cada campo muestra el valor EFECTIVO (tenant config → .env fallback).
     * Los campos sensibles se enmascaran. Se incluye la fuente por campo.
     */
    async getStatus(tenantId) {
        const status   = {};
        const features = tenantId
            ? await FeatureFlagService.getAll(tenantId).catch(() => ({}))
            : {};

        for (const [key, envDefaultFns] of Object.entries(ENV_DEFAULTS)) {
            const feat      = features[key] || {};
            const tenantCfg = feat.config   || {};

            // Por cada campo: valor efectivo + fuente
            const config      = {};
            const fieldSource = {};   // 'tenant' | 'global' | 'empty'

            for (const [field, envFn] of Object.entries(envDefaultFns)) {
                const tenantVal   = tenantCfg[field] || '';
                const envVal      = envFn() || '';
                const effective   = tenantVal || envVal;
                const isSensitive = SENSITIVE_FIELDS.includes(field);

                config[field]      = effective
                    ? (isSensitive ? '••••••• (guardado)' : effective)
                    : '';
                fieldSource[field] = tenantVal ? 'tenant' : (envVal ? 'global' : 'empty');
            }

            const hasTenantCfg = Object.keys(tenantCfg).some(k => tenantCfg[k]);
            const effectiveUri = tenantCfg.base_url || tenantCfg.smtp_host || tenantCfg.tenant_id
                              || envDefaultFns.base_url?.() || envDefaultFns.smtp_host?.()
                              || envDefaultFns.tenant_id?.() || '';
            const anyConfigured = Object.values(config).some(v => v);

            status[key] = {
                enabled:      feat.enabled ?? false,
                source:       hasTenantCfg ? 'tenant' : 'global',
                configured:   anyConfigured,
                effectiveUri: _maskUri(effectiveUri),
                modules:      INTEGRATION_MODULES[key] || [],
                config,
                fieldSource,
            };
        }

        return status;
    },
};

const SENSITIVE_FIELDS = ['api_token','client_secret','api_key','webhook_secret','smtp_pass'];

function _maskUri(uri) {
    if (!uri) return null;
    try {
        const u = new URL(uri);
        return u.hostname;
    } catch {
        return uri.length > 40 ? uri.slice(0, 37) + '…' : uri;
    }
}

module.exports = IntegrationConfigService;

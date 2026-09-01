'use strict';

/**
 * tenantConfig.js
 *
 * Carga la configuración estática de cada tenant desde config/tenants/[slug]/.
 * Cada tenant tiene su propia carpeta con config.js e integrations.js aislados.
 *
 * Los equipos de desarrollo modifican SOLO la carpeta de su cliente;
 * un error en config/tenants/petrotal/ nunca afecta a integratel y viceversa.
 */

const path = require('path');
const fs   = require('fs');

const TENANTS_DIR = path.join(__dirname, '../config/tenants');

// Índice construido en el primer acceso (singleton por proceso)
let _byId   = null;
let _bySlug = null;

function _buildIndex() {
    _byId   = {};
    _bySlug = {};

    if (!fs.existsSync(TENANTS_DIR)) return;

    for (const dir of fs.readdirSync(TENANTS_DIR)) {
        const cfgPath = path.join(TENANTS_DIR, dir, 'config.js');
        if (!fs.existsSync(cfgPath)) continue;

        try {
            const cfg = require(cfgPath);
            if (!cfg.id || !cfg.slug) continue;
            _byId[cfg.id]     = cfg;
            _bySlug[cfg.slug] = cfg;
        } catch (e) {
            // Un config roto de un tenant no rompe los demás
            console.warn(`[tenantConfig] Error cargando ${cfgPath}:`, e.message);
        }
    }
}

function _idx() {
    if (!_byId) _buildIndex();
    return { byId: _byId, bySlug: _bySlug };
}

/** Devuelve la config del tenant por ID numérico o slug string. null si no existe. */
function loadTenantConfig(idOrSlug) {
    const { byId, bySlug } = _idx();
    return byId[Number(idOrSlug)] || bySlug[String(idOrSlug)] || null;
}

/** Devuelve las integraciones del tenant. {} si no existen. */
function loadTenantIntegrations(idOrSlug) {
    const cfg = loadTenantConfig(idOrSlug);
    if (!cfg) return {};

    const intPath = path.join(TENANTS_DIR, cfg.slug, 'integrations.js');
    if (!fs.existsSync(intPath)) return {};

    try {
        return require(intPath);
    } catch (e) {
        console.warn(`[tenantConfig] Error cargando integrations de ${cfg.slug}:`, e.message);
        return {};
    }
}

/** Resuelve la config de tenant desde un request de Express. */
function getTenantConfig(req) {
    const id = req.tenant?.id ?? req.user?.tenant_id ?? null;
    return id ? loadTenantConfig(id) : null;
}

/** Lista todos los tenants registrados. */
function allTenants() {
    const { byId } = _idx();
    return Object.values(byId);
}

/** Invalida el índice en memoria y limpia el caché de require() de los archivos de tenant. */
function clearCache() {
    _byId   = null;
    _bySlug = null;

    if (!fs.existsSync(TENANTS_DIR)) return;
    for (const dir of fs.readdirSync(TENANTS_DIR)) {
        if (dir.startsWith('_')) continue;
        for (const file of ['config.js', 'integrations.js']) {
            const p = path.join(TENANTS_DIR, dir, file);
            if (fs.existsSync(p)) {
                try { delete require.cache[require.resolve(p)]; } catch (_) {}
            }
        }
    }
}

/**
 * Genera/sobreescribe los archivos config.js e integrations.js de un tenant.
 * Llamado automáticamente desde el provisioning del superadmin.
 *
 * @param {Object} tenant - { id, slug, name, domain, allowedEmailDomains?, features?, branding?, portal? }
 * @returns {string} - Ruta de la carpeta creada
 */
function generateTenantFiles(tenant) {
    const slug    = (tenant.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const envPfx  = slug.toUpperCase().replace(/-/g, '_');
    const dir     = path.join(TENANTS_DIR, slug);

    if (!slug) throw new Error('El tenant debe tener un slug válido');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const emailDomains = tenant.allowedEmailDomains
        || (tenant.domain ? [`@${tenant.domain}`] : []);

    const feat = tenant.features || {};
    const brand = tenant.branding || {};
    const sp = tenant.portal?.sharepoint || {};

    const configContent = `'use strict';

/**
 * Configuración del tenant: ${tenant.name}
 * ID en BD: ${tenant.id}
 * Generado automáticamente desde el portal superadmin.
 * Puedes editar este archivo para ajustar la configuración del cliente.
 */
module.exports = {
    id:   ${tenant.id},
    slug: '${slug}',
    name: '${(tenant.name || '').replace(/'/g, "\\'")}',
    domain: '${tenant.domain || ''}',

    allowedEmailDomains: ${JSON.stringify(emailDomains)},

    features: {
        jira:           ${feat.jira           ?? false},
        printQueue:     ${feat.printQueue     ?? false},
        microsoftTools: ${feat.microsoftTools ?? false},
        azureAD:        ${feat.azureAD        ?? false},
        localTickets:   ${feat.localTickets   ?? true},
    },

    branding: {
        bannerImage:  '${brand.bannerImage || 'banner-promo.jpg'}',
        bannerLink:   ${brand.bannerLink ? `'${brand.bannerLink}'` : 'null'},
        primaryColor: '${brand.primaryColor || '#2563eb'}',
    },

    portal: {
        sharepoint: {
            enabled: ${sp.enabled ?? false},
            url:     ${sp.url ? `'${sp.url}'` : 'null'},
        },
    },
};
`;

    const intgContent = `'use strict';

/**
 * Integraciones del tenant ${tenant.name}
 * Credenciales sensibles se leen de .env — nunca hardcodear tokens aquí.
 * Prefijo de variables de entorno: ${envPfx}_
 */
module.exports = {

    jira: {
        enabled:    false,
        host:       process.env.${envPfx}_JIRA_HOST    || null,
        email:      process.env.${envPfx}_JIRA_EMAIL   || null,
        token:      process.env.${envPfx}_JIRA_TOKEN   || null,
        projectKey: process.env.${envPfx}_JIRA_PROJECT || null,
    },

    microsoft: {
        enabled:      false,
        tenantId:     process.env.${envPfx}_MS_TENANT_ID     || null,
        clientId:     process.env.${envPfx}_MS_CLIENT_ID     || null,
        clientSecret: process.env.${envPfx}_MS_CLIENT_SECRET || null,
        allowedDomain:null,
    },

    outlook: { enabled: false },
    intune:  { enabled: false },
    teams:   { enabled: false },

};
`;

    fs.writeFileSync(path.join(dir, 'config.js'),       configContent, 'utf8');
    fs.writeFileSync(path.join(dir, 'integrations.js'), intgContent,   'utf8');

    clearCache();
    return dir;
}

module.exports = { loadTenantConfig, loadTenantIntegrations, getTenantConfig, allTenants, clearCache, generateTenantFiles };

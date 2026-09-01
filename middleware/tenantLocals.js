'use strict';

/**
 * tenantLocals.js
 *
 * Inyecta la config del tenant en res.locals antes de cada render EJS.
 * Debe montarse DESPUÉS de tenantMiddleware (que pone req.tenant).
 *
 * En plantillas EJS se usa:
 *   tenantCfg.features.jira        → boolean
 *   tenantCfg.branding.bannerImage → 'banner-promo.jpg'
 *   tenantCfg.name                 → 'Integratel'
 *   jiraEnabled                    → shortcut boolean
 */

const { getTenantConfig } = require('../utils/tenantConfig');

module.exports = function tenantLocals(req, res, next) {
    let cfg = getTenantConfig(req);

    // Banner uploaded via admin takes precedence over static config file
    const bannerFromDb = req.tenant?.config?.bannerImage;
    if (cfg && bannerFromDb) {
        cfg = { ...cfg, branding: { ...(cfg.branding || {}), bannerImage: bannerFromDb } };
    }

    res.locals.tenantCfg    = cfg;
    res.locals.jiraEnabled  = cfg?.features?.jira ?? false;
    res.locals.tenantName   = cfg?.name           ?? null;
    res.locals.tenantDomain = cfg?.domain         ?? null;

    next();
};

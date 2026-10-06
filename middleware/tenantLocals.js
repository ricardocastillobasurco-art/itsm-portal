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
 *   tenantCfg.name                 → 'Mi Empresa'
 *   jiraEnabled                    → shortcut boolean
 *   brand                          → marca de la empresa (BrandingService):
 *                                    companyName, logoUrl, primaryColor, supportName, portalTitle
 *   brandJson                      → brand serializado seguro para <script>
 *
 * La empresa se resuelve AL RENDERIZAR: la autenticación corre después de este
 * middleware (en cada ruta), así que antes de eso req.user aún no existe y
 * req.tenant es la empresa por defecto.
 */

const { getTenantConfig, loadTenantConfig } = require('../utils/tenantConfig');
const Branding = require('../src/services/BrandingService');

function _setLocals(req, res, brand, userTid = null) {
    const tid = userTid ?? req.user?.tenant_id ?? req.tenant?.id ?? null;
    let cfg = (userTid ?? req.user?.tenant_id ? loadTenantConfig(userTid ?? req.user.tenant_id) : null) || getTenantConfig(req);

    // Banner uploaded via admin takes precedence over static config file
    const bannerFromDb = req.tenant?.config?.bannerImage;
    if (cfg && bannerFromDb) {
        cfg = { ...cfg, branding: { ...(cfg.branding || {}), bannerImage: bannerFromDb } };
    }
    // Empresas creadas desde el superadmin no tienen carpeta en config/tenants:
    // se completan con los datos de la BD para que muestren su nombre.
    if (!cfg && tid) {
        cfg = { id: Number(tid), name: brand.companyName, domain: req.tenant?.domain ?? null,
                features: {}, branding: { primaryColor: brand.primaryColor } };
    }

    res.locals.tenantCfg    = cfg;
    res.locals.jiraEnabled  = res.locals.jiraEnabled ?? (cfg?.features?.jira ?? false);
    res.locals.tenantName   = brand.companyName ?? cfg?.name ?? null;
    res.locals.tenantDomain = cfg?.domain ?? null;
    res.locals.brand        = brand;
    res.locals.brandJson    = JSON.stringify(brand).replace(/</g, '\\u003c');
}

module.exports = function tenantLocals(req, res, next) {
    // Jira del tenant dueño (las vistas solo lo usan para el tenant 1)
    res.locals.jiraHost = (process.env.JIRA_HOST || '').replace(/\/$/, '');
    _setLocals(req, res, { ...Branding.DEFAULTS, portalTitle: 'SERVICIOS TI' });

    const render = res.render.bind(res);
    res.render = function (view, options, callback) {
        // Algunas rutas validan la sesión por su cuenta y pasan `user` a la vista
        const userTid = (options && typeof options === 'object' && options.user?.tenant_id) || req.user?.tenant_id || null;
        const tid = userTid ?? req.tenant?.id ?? null;
        const go = (brand) => {
            if (brand) _setLocals(req, res, brand, userTid);
            // Selector de empresa (técnicos multiempresa) en todas las pantallas del panel de TI.
            // El script solo se muestra si el usuario atiende más de una empresa.
            const staff = ['administrador', 'especialista', 'agente', 'tecnico'].includes(req.user?.home_role || req.user?.role);
            if (staff && !callback && typeof options !== 'function' && String(view).startsWith('admin_platform/')) {
                return render(view, options, (err, html) => {
                    if (err) return req.next(err);
                    const tag = '<script src="/js/company-switcher.js" defer></script>';
                    res.send(html.includes('</body>') ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, tag + '</body>') : html + tag);
                });
            }
            return render(view, options, callback);
        };
        if (!tid) return go(null);
        Branding.get(tid).then(go, () => go(null));
    };
    next();
};

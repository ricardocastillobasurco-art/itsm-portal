'use strict';

const { authenticateToken } = require('./auth');
const { MODULES, hasModule } = require('../src/config/plans');

// Bloquea un módulo que no está incluido en el plan del tenant.
// Autentica primero si hace falta: el tenant real sale del usuario, no del host.
module.exports = function requireModule(moduleKey) {
    if (!MODULES[moduleKey]) throw new Error(`requireModule: módulo desconocido "${moduleKey}"`);

    return (req, res, next) => {
        const check = () => {
            if (hasModule(req.tenant, moduleKey)) return next();

            const message = `El módulo "${MODULES[moduleKey].label}" no está incluido en el plan de tu empresa`;
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(403).json({ success: false, error: message, module: moduleKey, upgradeRequired: true });
            }
            return res.status(403).send(
                `<!doctype html><meta charset="utf-8"><title>Módulo no disponible</title>
                 <div style="font-family:system-ui;max-width:480px;margin:15vh auto;text-align:center;color:#172b4d">
                   <h2>Módulo no disponible</h2><p>${message}.</p>
                   <p>Contacta al administrador para ampliar tu plan.</p>
                   <a href="javascript:history.back()">Volver</a></div>`);
        };
        if (req.user) return check();
        authenticateToken(req, res, check);
    };
};

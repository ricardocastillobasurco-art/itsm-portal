'use strict';

// Administración del registro autoservicio (solo superadmin) — /api/admin/signup

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const Signup = require('../../src/services/SignupService');
const Settings = require('../../src/services/PlatformSettings');

router.use(authenticateToken, requireRole('superadmin'));
const wrap = (fn) => async (req, res) => {
    try { res.json({ success: true, data: await fn(req) }); }
    catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};

// Configuración del registro y de la marca de la plataforma
router.get('/settings', wrap(async () => {
    const s = await Settings.getAll();
    return { signup_mode: s.signup_mode, trial_days: s.trial_days, brand_name: s.brand_name, brand_url: s.brand_url };
}));
router.put('/settings', wrap(async (req) => {
    const b = req.body || {};
    const out = {};
    if (b.signup_mode !== undefined) {
        if (!['invite', 'open', 'closed'].includes(b.signup_mode)) throw Object.assign(new Error('Modo inválido'), { status: 400 });
        out.signup_mode = b.signup_mode;
    }
    if (b.trial_days !== undefined) {
        const d = parseInt(b.trial_days);
        if (!(d >= 7 && d <= 90)) throw Object.assign(new Error('La prueba debe durar entre 7 y 90 días'), { status: 400 });
        out.trial_days = d;
    }
    if (b.brand_name !== undefined) out.brand_name = String(b.brand_name).trim().slice(0, 60) || Settings.DEFAULTS.brand_name;
    if (b.brand_url !== undefined) {
        const u = String(b.brand_url).trim();
        if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw Object.assign(new Error('La URL debe empezar con http:// o https://'), { status: 400 });
        out.brand_url = u.slice(0, 200);
    }
    const s = await Settings.set(out);
    return { signup_mode: s.signup_mode, trial_days: s.trial_days, brand_name: s.brand_name, brand_url: s.brand_url };
}));

// Invitaciones
router.get('/invites', wrap(() => Signup.listInvites()));
router.post('/invites', wrap((req) => Signup.createInvite(req.body || {}, req.user?.id)));
router.delete('/invites/:id', wrap(async (req) => { await Signup.revokeInvite(parseInt(req.params.id)); return null; }));

// Registros (pendientes de verificar y recientes). Mientras no haya correo de salida,
// el código pendiente se muestra aquí para poder ayudar al cliente.
router.get('/requests', wrap(() => Signup.listRequests()));

module.exports = router;

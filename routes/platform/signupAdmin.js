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

// Límites por plan (null = sin límite)
const LIMIT_PLANS = ['free', 'trial', 'professional'];
const LIMIT_KEYS = ['technicians', 'devices', 'ai_per_month', 'storage_gb', 'devices_per_technician'];
router.get('/plan-limits', wrap(async () => (await Settings.get('plan_limits'))));
router.put('/plan-limits', wrap(async (req) => {
    const cur = (await Settings.get('plan_limits')) || {};
    const next = { ...cur };
    for (const plan of LIMIT_PLANS) {
        const inp = req.body?.[plan];
        if (!inp || typeof inp !== 'object') continue;
        const row = { ...(cur[plan] || {}) };
        for (const k of LIMIT_KEYS) {
            if (!(k in inp)) continue;
            const v = inp[k];
            if (v === null || v === '') { row[k] = null; continue; }
            const n = Number(v);
            if (!(n >= 0 && n <= 100000)) throw Object.assign(new Error('Límite inválido: ' + plan + ' · ' + k), { status: 400 });
            row[k] = k === 'storage_gb' ? Math.round(n * 10) / 10 : Math.round(n);
        }
        next[plan] = row;
    }
    await Settings.set({ plan_limits: next });
    return Settings.get('plan_limits');
}));

// Invitaciones
router.get('/invites', wrap(() => Signup.listInvites()));
router.post('/invites', wrap((req) => Signup.createInvite(req.body || {}, req.user?.id)));
router.delete('/invites/:id', wrap(async (req) => { await Signup.revokeInvite(parseInt(req.params.id)); return null; }));

// Registros (pendientes de verificar y recientes). Mientras no haya correo de salida,
// el código pendiente se muestra aquí para poder ayudar al cliente.
router.get('/requests', wrap(() => Signup.listRequests()));

// Precios que se muestran en /planes (texto libre: "15", "15/mes", "Consultar"...)
const PRICING_KEYS = ['currency', 'pro_per_technician', 'extra_device', 'managed_per_user', 'contact_email', 'contact_whatsapp'];
router.get('/pricing', wrap(() => Settings.get('pricing')));
router.put('/pricing', wrap(async (req) => {
    const cur = (await Settings.get('pricing')) || {};
    const next = { ...cur };
    for (const k of PRICING_KEYS) if (req.body && k in req.body) next[k] = String(req.body[k] ?? '').trim().slice(0, 80);
    if (next.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.contact_email)) throw Object.assign(new Error('Correo de contacto inválido'), { status: 400 });
    await Settings.set({ pricing: next });
    return Settings.get('pricing');
}));

// Panel comercial
const Commercial = require('../../src/services/CommercialService');
router.get('/commercial', wrap(() => Commercial.summary()));
router.get('/sales', wrap((req) => Commercial.listRequests({ status: req.query.status })));
router.patch('/sales/:id', wrap(async (req) => { await Commercial.updateRequest(parseInt(req.params.id), req.body || {}); return null; }));
router.post('/billing-run', wrap(() => Commercial.billingRun()));

module.exports = router;

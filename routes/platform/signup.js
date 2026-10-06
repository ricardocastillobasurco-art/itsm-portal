'use strict';

// Registro autoservicio (público) — /api/signup
//   GET  /config?i=<invitación>   modo de registro, días de prueba, datos de la invitación
//   GET  /challenge               pregunta "no soy un robot"
//   POST /start                   datos de la empresa → envía código por correo
//   POST /resend                  reenvía el código
//   POST /verify                  código → crea la empresa e inicia la sesión
// Administración (superadmin) — /api/admin/signup: ver routes/platform/signupAdmin.js

const express = require('express');
const router = express.Router();
const Signup = require('../../src/services/SignupService');

// req.ip ya considera el proxy (trust proxy): no se usa X-Forwarded-For directo porque el cliente puede falsearlo
const clientIp = (req) => String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
const send = (res, e) => res.status(e.status || 500).json({ success: false, message: e.status ? e.message : 'No se pudo completar el registro', code: e.code });

router.get('/config', async (req, res) => {
    try { res.json({ success: true, data: await Signup.publicConfig(req.query.i) }); }
    catch (e) { send(res, e); }
});

router.get('/challenge', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: Signup.challenge() });
});

router.post('/start', async (req, res) => {
    try { res.json({ success: true, data: await Signup.start(req.body || {}, clientIp(req)) }); }
    catch (e) { if (!e.status) console.error('[registro]', e); send(res, e); }
});

router.post('/resend', async (req, res) => {
    try { res.json({ success: true, data: await Signup.resend(parseInt(req.body?.requestId), clientIp(req)) }); }
    catch (e) { send(res, e); }
});

router.post('/verify', async (req, res) => {
    try {
        const { tenant, user } = await Signup.verify(parseInt(req.body?.requestId), req.body?.code);
        await require('./auth').issueSession(res, user);
        res.json({ success: true, data: { company: tenant.name, redirect: '/bienvenida' } });
    } catch (e) { if (!e.status) console.error('[registro]', e); send(res, e); }
});

module.exports = router;

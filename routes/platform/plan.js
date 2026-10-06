'use strict';

// Plan de la empresa activa: límites, uso, días de prueba — /api/plan

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { tenantId } = require('../../src/utils/tenantScope');
const PlanService = require('../../src/services/PlanService');

router.get('/status', authenticateToken, async (req, res) => {
    try { res.json({ success: true, data: await PlanService.status(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Primeros pasos (solo personal de TI; el aviso lo muestra plan-banner.js)
router.get('/checklist', authenticateToken, async (req, res) => {
    try { res.json({ success: true, data: await require('../../src/services/GettingStartedService').checklist(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
router.post('/checklist/dismiss', authenticateToken, async (req, res) => {
    try { await require('../../src/services/GettingStartedService').dismiss(tenantId(req)); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Página de planes: precios configurados por el superadmin + plan actual
router.get('/offer', authenticateToken, async (req, res) => {
    try {
        const Settings = require('../../src/services/PlatformSettings');
        const all = await Settings.getAll();
        res.json({ success: true, data: { status: await PlanService.status(tenantId(req)), pricing: all.pricing, limits: all.plan_limits, brand: all.brand_name } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// "Quiero el plan Pro" / "Contratar soporte gestionado" — solo administradores de la empresa
router.post('/request', authenticateToken, async (req, res) => {
    try {
        if (!['administrador', 'admin', 'superadmin'].includes(req.user?.role)) {
            return res.status(403).json({ success: false, message: 'Solo el administrador de la empresa puede solicitarlo' });
        }
        const { type, ...data } = req.body || {};
        const out = await require('../../src/services/CommercialService').createRequest(tenantId(req), req.user, type, data);
        res.json({ success: true, data: out });
    } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
});

module.exports = router;

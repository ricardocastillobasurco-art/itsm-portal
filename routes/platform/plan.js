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

module.exports = router;

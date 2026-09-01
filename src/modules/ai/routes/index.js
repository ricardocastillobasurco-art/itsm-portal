'use strict';

const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../../../../middleware/auth');
const ctrl = require('../controller/AiController');

// POST /api/ai/classify  — clasifica un ticket por texto
router.post('/classify',    authenticateToken, ctrl.classify);

// POST /api/ai/kb-search  — búsqueda semántica en KB
router.post('/kb-search',   authenticateToken, ctrl.kbSearch);

// POST /api/ai/aria/chat  — conversación con ARIA
router.post('/aria/chat',   authenticateToken, ctrl.ariaChat);

// GET  /api/ai/status     — estado del proveedor IA (sin auth para healthcheck)
router.get('/status',       ctrl.status);

module.exports = router;

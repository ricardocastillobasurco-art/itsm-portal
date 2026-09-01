'use strict';

const express = require('express');
const router  = express.Router();

const { authenticateToken } = require('../../../../middleware/auth');
const { requirePolicy }     = require('../../../middlewares/authorization');
const ctrl = require('../controller/TicketController');

const auth = authenticateToken;
const can  = requirePolicy;

// ── KPIs primero — antes del /:id para evitar colisión de parámetros ─────────
router.get('/tickets/kpis',              auth, can('ticket', 'read'),   ctrl.kpis);
router.get('/tickets/categories',        auth,                           ctrl.categories);

// ── CRUD de tickets ───────────────────────────────────────────────────────────
router.get('/tickets',                   auth, can('ticket', 'read'),   ctrl.list);
router.get('/tickets/:id',               auth, can('ticket', 'read'),   ctrl.getOne);
router.post('/tickets',                  auth, can('ticket', 'create'), ctrl.create);
router.patch('/tickets/:id',             auth, can('ticket', 'update'), ctrl.update);
router.delete('/tickets/:id',            auth, can('ticket', 'delete'), ctrl.remove);

// ── Sub-recursos ──────────────────────────────────────────────────────────────
router.post('/tickets/:id/comments',     auth, can('ticket', 'update'), ctrl.addComment);
router.post('/tickets/:id/attachments',  auth, can('ticket', 'update'), ctrl.upload.single('file'), ctrl.addAttachment);

// ── Categorías (alias en raíz del módulo) ─────────────────────────────────────
router.get('/categories',                auth,                           ctrl.categories);

module.exports = router;

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../../../../middleware/auth');
const ctrl = require('../controller/ProblemController');

router.get('/kpis',               authenticateToken, ctrl.kpis);
router.get('/',                   authenticateToken, ctrl.list);
router.get('/:id',                authenticateToken, ctrl.getOne);
router.post('/',                  authenticateToken, ctrl.create);
router.patch('/:id',              authenticateToken, ctrl.update);
router.post('/:id/known-errors',  authenticateToken, ctrl.addKnownError);

module.exports = router;

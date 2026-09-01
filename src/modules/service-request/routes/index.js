'use strict';

const express = require('express');
const router  = express.Router();

const { authenticateToken } = require('../../../../middleware/auth');
const ctrl = require('../controller/ServiceRequestController');

router.get('/',               authenticateToken, ctrl.list);
router.get('/catalog',        authenticateToken, ctrl.catalog);
router.get('/software',       authenticateToken, ctrl.software);
router.post('/software',      authenticateToken, ctrl.createSoftware);
router.delete('/software/:id',authenticateToken, ctrl.removeSoftware);
router.get('/:id',            authenticateToken, ctrl.getOne);
router.post('/',              authenticateToken, ctrl.create);
router.patch('/:id',          authenticateToken, ctrl.update);
router.post('/:id/approve',   authenticateToken, ctrl.approve);
router.post('/:id/notify',    authenticateToken, ctrl.notify);

module.exports = router;

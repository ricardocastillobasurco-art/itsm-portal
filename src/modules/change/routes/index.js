'use strict';

const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../../../../middleware/auth');
const { requirePolicy }     = require('../../../middlewares/authorization');
const ctrl = require('../controller/ChangeController');

const auth = authenticateToken;
const can  = requirePolicy;

router.get('/kpis',                  auth, can('change', 'read'),    ctrl.kpis);
router.get('/',                      auth, can('change', 'read'),    ctrl.list);
router.get('/:id',                   auth, can('change', 'read'),    ctrl.getOne);
router.post('/',                     auth, can('change', 'create'),  ctrl.create);
router.patch('/:id',                 auth, can('change', 'update'),  ctrl.update);
router.post('/:id/submit-approval',  auth, can('change', 'update'),  ctrl.submitForApproval);
router.post('/:id/approve',          auth, can('change', 'approve'), ctrl.approve);
router.delete('/:id',                auth, can('change', 'delete'),  ctrl.remove);

module.exports = router;

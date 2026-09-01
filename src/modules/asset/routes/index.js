'use strict';

const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../../../../middleware/auth');
const { requirePolicy }     = require('../../../middlewares/authorization');
const ctrl = require('../controller/CmdbController');

const auth = authenticateToken;
const can  = requirePolicy;

router.get('/types',                    auth, can('asset', 'read'),   ctrl.types);
router.get('/kpis',                     auth, can('asset', 'read'),   ctrl.kpis);
router.get('/',                         auth, can('asset', 'read'),   ctrl.list);
router.get('/:id',                      auth, can('asset', 'read'),   ctrl.getOne);
router.post('/',                        auth, can('asset', 'create'), ctrl.create);
router.patch('/:id',                    auth, can('asset', 'update'), ctrl.update);
router.delete('/:id',                   auth, can('asset', 'delete'), ctrl.remove);
router.post('/:id/relationships',       auth, can('asset', 'update'), ctrl.addRelationship);
router.delete('/relationships/:relId',  auth, can('asset', 'update'), ctrl.removeRelationship);

module.exports = router;

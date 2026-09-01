'use strict';

const express      = require('express');
const router       = express.Router();
const GraphService = require('../../src/services/integrations/GraphService');
const tenantRepo   = require('../../src/repositories/platform/TenantRepository');

// GET /api/tenant-graph/config — config del tenant actual (sin secretos)
router.get('/config', async (req, res) => {
    try {
        const graph = GraphService.fromTenant(req.tenant);
        res.json({ success: true, data: { tenant: req.tenant?.slug, ...graph.configSummary() } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/tenant-graph/config — guarda Graph config en tenant.settings
// Body: { clientId, tenantId, clientSecret, mailbox }
router.put('/config', async (req, res) => {
    try {
        const { clientId, tenantId, clientSecret, mailbox } = req.body || {};
        if (!clientId || !tenantId || !clientSecret || !mailbox)
            return res.status(400).json({ success: false, error: 'clientId, tenantId, clientSecret y mailbox son requeridos' });

        const tid = req.tenant?.id;
        if (!tid)
            return res.status(400).json({ success: false, error: 'Tenant no identificado en esta sesión' });

        const current  = await tenantRepo.findById(tid);
        const settings = { ...(current?.settings || {}), graph: { clientId, tenantId, clientSecret, mailbox } };

        await tenantRepo.updateSettings(tid, settings);

        const graph = new GraphService({ clientId, tenantId, clientSecret, mailbox });
        res.json({ success: true, message: 'Configuración Graph guardada', data: graph.configSummary() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/tenant-graph/config — elimina Graph config del tenant
router.delete('/config', async (req, res) => {
    try {
        const tid = req.tenant?.id;
        if (!tid)
            return res.status(400).json({ success: false, error: 'Tenant no identificado' });

        const current  = await tenantRepo.findById(tid);
        const settings = { ...(current?.settings || {}) };
        delete settings.graph;

        await tenantRepo.updateSettings(tid, settings);
        res.json({ success: true, message: 'Configuración Graph eliminada' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/tenant-graph/test — verifica que las credenciales funcionen
router.post('/test', async (req, res) => {
    try {
        const graph = GraphService.fromTenant(req.tenant);
        if (!graph.isConfigured())
            return res.status(400).json({ success: false, error: 'Graph no configurado para este tenant' });

        const token = await graph.getToken();
        const me    = await graph.get(token, `https://graph.microsoft.com/v1.0/users/${graph.mailbox}?$select=displayName,mail,userPrincipalName`);

        res.json({ success: true, message: 'Conexión Graph exitosa', data: { displayName: me.displayName, mail: me.mail || me.userPrincipalName } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

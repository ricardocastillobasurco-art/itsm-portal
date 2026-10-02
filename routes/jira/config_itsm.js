const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { executeQuery, equipmentPool } = require('../../config/database');
const { tenantId } = require('../../src/utils/tenantScope');
const Catalogs = require('../../src/services/TicketCatalogService');

// Configuración ITSM por empresa (alertas, escalamiento, NOC), guardada en
// itsm_automations con la clave 'itsm_settings'. La empresa 1 conserva como
// valor inicial el antiguo archivo config/itsm_settings.json.
const LEGACY_PATH = path.join(__dirname, '../../config/itsm_settings.json');
const SETTINGS_KEY = 'itsm_settings';
const requireAdmin = requireRole('administrador', 'admin');

const DEFAULTS = {
    sla:        { P1: 60, P2: 240, P3: 480, P4: 1440 },
    alerts:     { window_minutes: 10, breach_notification: true },
    escalation: { emails: '', enabled: false },
    noc:        { queue: 'wp', refresh_seconds: 60 }
};

function merge(base, over = {}) {
    return {
        sla:        { ...base.sla,        ...(over.sla        || {}) },
        alerts:     { ...base.alerts,     ...(over.alerts     || {}) },
        escalation: { ...base.escalation, ...(over.escalation || {}) },
        noc:        { ...base.noc,        ...(over.noc        || {}) },
    };
}

async function getSettings(tid = 1) {
    tid = Number(tid) || 1;
    const [row] = await executeQuery(equipmentPool,
        'SELECT value FROM itsm_automations WHERE tenant_id = ? AND `key` = ? LIMIT 1', [tid, SETTINGS_KEY]);
    if (row?.value) {
        try { return merge(DEFAULTS, JSON.parse(row.value)); } catch (_) { /* valor dañado: defaults */ }
    }
    if (tid === 1) {
        try { return merge(DEFAULTS, JSON.parse(fs.readFileSync(LEGACY_PATH, 'utf8'))); } catch (_) {}
    }
    return merge(DEFAULTS);
}

router.get('/config/itsm', authenticateToken, async (req, res) => {
    try { res.json({ success: true, data: await getSettings(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/config/itsm', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const tid  = tenantId(req);
        const next = merge(await getSettings(tid), req.body || {});
        // Sanitize numeric fields
        ['P1','P2','P3','P4'].forEach(p => {
            const v = parseInt(next.sla[p]);
            next.sla[p] = !isNaN(v) && v > 0 ? v : DEFAULTS.sla[p];
        });
        next.alerts.window_minutes = Math.max(1, Math.min(120, parseInt(next.alerts.window_minutes) || 10));
        next.alerts.breach_notification = !!next.alerts.breach_notification;
        next.escalation.enabled = !!next.escalation.enabled;
        next.escalation.emails  = String(next.escalation.emails || '').slice(0, 1000);
        next.noc.queue = String(next.noc.queue || 'wp').slice(0, 40);
        next.noc.refresh_seconds   = Math.max(15, Math.min(300, parseInt(next.noc.refresh_seconds) || 60));
        await executeQuery(equipmentPool,
            `INSERT INTO itsm_automations (tenant_id, \`key\`, value) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)`, [tid, SETTINGS_KEY, JSON.stringify(next)]);
        res.json({ success: true, data: next });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Catálogos de cierre (tipo de resolución, proceso, resultado) ────────────
router.get('/config/close-catalogs', authenticateToken, async (req, res) => {
    try { res.json({ success: true, data: await Catalogs.getCatalogs(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/config/close-catalogs', authenticateToken, requireAdmin, async (req, res) => {
    try { res.json({ success: true, data: await Catalogs.saveCatalogs(tenantId(req), req.body || {}) }); }
    catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
});

router.delete('/config/close-catalogs', authenticateToken, requireAdmin, async (req, res) => {
    try { res.json({ success: true, data: await Catalogs.resetCatalogs(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Marca de la empresa (nombre, logo, color, textos del portal) ────────────
const Branding = require('../../src/services/BrandingService');
const multer = require('multer');
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });

router.get('/config/branding', authenticateToken, async (req, res) => {
    try { res.json({ success: true, data: await Branding.get(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/config/branding', authenticateToken, requireAdmin, async (req, res) => {
    try { res.json({ success: true, data: await Branding.save(tenantId(req), req.body || {}) }); }
    catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
});

router.post('/config/branding/logo', authenticateToken, requireAdmin, (req, res) => {
    logoUpload.single('logo')(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false,
            message: err.code === 'LIMIT_FILE_SIZE' ? 'El logo debe pesar menos de 1 MB' : err.message });
        if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió el logo' });
        try { res.json({ success: true, data: await Branding.saveLogo(tenantId(req), req.file) }); }
        catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
    });
});

router.delete('/config/branding/logo', authenticateToken, requireAdmin, async (req, res) => {
    try { res.json({ success: true, data: await Branding.removeLogo(tenantId(req)) }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


// Envía la exportación de datos de una empresa como ZIP descargable
async function sendTenantExport(req, res, tid) {
    const { exportTenant } = require('../../src/services/TenantExportService');
    const { executeQuery, equipmentPool } = require('../../config/database');
    const [t] = await executeQuery(equipmentPool, 'SELECT slug FROM tenants WHERE id = ?', [tid]);
    if (!t) return res.status(404).json({ success: false, message: 'Empresa no encontrada' });
    const name = `datos-${String(t.slug || tid).replace(/[^a-z0-9-]/gi, '')}-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
        await exportTenant(tid, res, { includeFiles: req.query.archivos === '1',
            requestedBy: { id: req.user?.id ?? null, email: req.user?.email ?? null, role: req.user?.role ?? null } });
    } catch (e) {
        console.error('[exportación]', tid, e.message);
        if (!res.headersSent) res.status(e.status || 500).json({ success: false, message: e.message });
        else res.destroy(e);
    }
}

// GET /api/jira/config/export[?archivos=1] — el administrador descarga todos los datos de SU empresa
router.get('/config/export', authenticateToken, requireAdmin, (req, res) => sendTenantExport(req, res, tenantId(req)));

module.exports = router;
module.exports.getSettings = getSettings;

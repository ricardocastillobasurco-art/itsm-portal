const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { authenticateToken } = require('../../middleware/auth');

const SETTINGS_PATH = path.join(__dirname, '../../config/itsm_settings.json');

const DEFAULTS = {
    sla:        { P1: 60, P2: 240, P3: 480, P4: 1440 },
    alerts:     { window_minutes: 10, breach_notification: true },
    escalation: { emails: '', enabled: false },
    noc:        { queue: 'wp', refresh_seconds: 60 }
};

function getSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
    catch(e) { return { ...DEFAULTS }; }
}

function saveSettings(data) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/config/itsm', authenticateToken, (_req, res) => {
    res.json({ success: true, data: getSettings() });
});

router.post('/config/itsm', authenticateToken, (req, res) => {
    try {
        const cur = getSettings();
        const next = {
            sla:        { ...cur.sla,        ...(req.body.sla        || {}) },
            alerts:     { ...cur.alerts,     ...(req.body.alerts     || {}) },
            escalation: { ...cur.escalation, ...(req.body.escalation || {}) },
            noc:        { ...cur.noc,        ...(req.body.noc        || {}) },
        };
        // Sanitize numeric fields
        ['P1','P2','P3','P4'].forEach(p => {
            const v = parseInt(next.sla[p]);
            if (!isNaN(v) && v > 0) next.sla[p] = v;
            else next.sla[p] = DEFAULTS.sla[p];
        });
        next.alerts.window_minutes = Math.max(1, Math.min(120, parseInt(next.alerts.window_minutes) || 10));
        next.noc.refresh_seconds   = Math.max(15, Math.min(300, parseInt(next.noc.refresh_seconds) || 60));
        saveSettings(next);
        res.json({ success: true, data: next });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
module.exports.getSettings = getSettings;

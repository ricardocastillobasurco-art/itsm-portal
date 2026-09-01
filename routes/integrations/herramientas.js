const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const UserToolData    = require('../../src/models/integrations/UserToolData');
const UserToolHistory = require('../../src/models/integrations/UserToolHistory');

const MAX_HISTORY  = 25;
const VALID_TOOLS  = new Set(['notas','gantt','bpmn','pizarra','mapas','turnos','pomodoro','eventos']);

// ── GET /api/herramientas/all ─────────────────────────────────────────────────
router.get('/all', authenticateToken, async (req, res) => {
    try {
        const rows   = await UserToolData.findAll({ where: { user_id: req.user.id } });
        const result = {};
        rows.forEach(r => { result[r.tool] = r.data; });
        res.json({ ok: true, data: result });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── POST /api/herramientas/:tool ──────────────────────────────────────────────
router.post('/:tool', authenticateToken, async (req, res) => {
    try {
        const { tool } = req.params;
        if (!VALID_TOOLS.has(tool)) return res.status(400).json({ ok: false, error: 'Tool no válido' });

        const { data, label } = req.body;
        const userId = req.user.id;   // NUNCA del body

        await UserToolData.upsert({ user_id: userId, tool, data });
        await UserToolHistory.create({ user_id: userId, tool, data, label: label || null });

        // Mantener solo los últimos MAX_HISTORY registros
        const old = await UserToolHistory.findAll({
            where:      { user_id: userId, tool },
            order:      [['created_at', 'DESC']],
            offset:     MAX_HISTORY,
            attributes: ['id'],
        });
        if (old.length) {
            await UserToolHistory.destroy({ where: { id: old.map(r => r.id) } });
        }

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── GET /api/herramientas/:tool/history ───────────────────────────────────────
router.get('/:tool/history', authenticateToken, async (req, res) => {
    try {
        const { tool }   = req.params;
        const { q = '' } = req.query;
        const userId     = req.user.id;

        const rows = await UserToolHistory.findAll({
            where:      { user_id: userId, tool },
            order:      [['created_at', 'DESC']],
            limit:      MAX_HISTORY,
            attributes: ['id', 'label', 'created_at', 'data'],
        });

        const filtered = q
            ? rows.filter(r =>
                (r.label || '').toLowerCase().includes(q.toLowerCase()) ||
                JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase()))
            : rows;

        res.json({ ok: true, history: filtered });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── POST /api/herramientas/:tool/restore/:id ──────────────────────────────────
router.post('/:tool/restore/:histId', authenticateToken, async (req, res) => {
    try {
        const { tool, histId } = req.params;
        const userId = req.user.id;

        const entry = await UserToolHistory.findOne({
            where: { id: histId, user_id: userId, tool },
        });
        if (!entry) return res.status(404).json({ ok: false, error: 'Versión no encontrada' });

        await UserToolData.upsert({ user_id: userId, tool, data: entry.data });
        res.json({ ok: true, data: entry.data });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── DELETE /api/herramientas/:tool/history/:id ────────────────────────────────
router.delete('/:tool/history/:histId', authenticateToken, async (req, res) => {
    try {
        const { tool, histId } = req.params;
        const deleted = await UserToolHistory.destroy({
            where: { id: histId, user_id: req.user.id, tool },
        });
        if (!deleted) return res.status(404).json({ ok: false, error: 'No encontrado' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;

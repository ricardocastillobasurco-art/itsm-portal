'use strict';

// Técnicos multiempresa: ver las empresas que atiendo y cambiar de empresa activa.
// La administración de accesos está en /api/admin/tenants/:tenantId/technicians (superadmin).

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const CompanyAccess = require('../../src/services/CompanyAccessService');

const STAFF = ['administrador', 'especialista', 'agente', 'tecnico'];
const cookieOpts = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 12 * 3600 * 1000 });

// GET /api/companies/mine — empresas que puede atender el usuario (la activa marcada)
router.get('/mine', authenticateToken, async (req, res) => {
    try {
        if (!STAFF.includes(req.user.home_role || req.user.role)) return res.json({ success: true, data: [] });
        res.json({ success: true, data: await CompanyAccess.companiesOf(req.user) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/companies/switch { tenantId } — cambia la empresa activa
router.post('/switch', authenticateToken, async (req, res) => {
    try {
        const tid = Number(req.body?.tenantId);
        const home = Number(req.user.home_tenant_id || req.user.tenant_id) || 1;
        if (!tid) return res.status(400).json({ success: false, message: 'Empresa requerida' });
        if (tid === home) {
            res.clearCookie(CompanyAccess.COOKIE, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
        } else {
            const role = await CompanyAccess.accessRole(req.user.id, tid);
            if (!role) return res.status(403).json({ success: false, message: 'No tienes acceso a esa empresa' });
            res.cookie(CompanyAccess.COOKIE, CompanyAccess.cookieValue(req.user.id, tid), cookieOpts());
        }
        await CompanyAccess.audit(tid, 'tech_company_switch', req.user.id, { from: Number(req.user.tenant_id), to: tid, email: req.user.email });
        res.json({ success: true, tenantId: tid });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;

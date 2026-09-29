// routes/employees.js
'use strict';

const express = require('express');
const router  = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth, logActivity } = require('../../middleware/auth');
const { checkPermission } = require('../../middleware/permissions');
const employeeService = require('../../src/services/platform/EmployeeService');
const { tenantId } = require('../../src/utils/tenantScope');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.fail('Datos inválidos', 400, 'VALIDATION_ERROR');
  next();
};

// ── Vista empleados ───────────────────────────────────────────────────────
router.get('/employees', authenticateToken, async (req, res) => {
  try {
    const employees = await employeeService.findAllForView(tenantId(req));
    res.render('employees', { title: 'Gestión de Empleados', employees, currentPage: 1, totalPages: 1, search: '' });
  } catch (err) {
    console.error('❌ Error:', err);
    res.status(500).send('Error al cargar empleados');
  }
});

// ── GET /search-emails ────────────────────────────────────────────────────
router.get('/search-emails', authenticateToken, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.ok([]);
    res.ok(await employeeService.searchEmails(q, 10, tenantId(req)));
  } catch (err) {
    next(err);
  }
});

// ── GET /bajas ────────────────────────────────────────────────────────────
router.get('/bajas', authenticateToken, checkPermission('employees', 'read'), async (req, res) => {
  try {
    res.ok(await employeeService.findInactive(tenantId(req)));
  } catch (err) {
    res.fail('Error al listar empleados de baja');
  }
});

// ── PUT /toggle-status ────────────────────────────────────────────────────
router.put('/toggle-status', authenticateToken, checkPermission('employees', 'update'), async (req, res) => {
  try {
    const { cip, is_active } = req.body;
    if (!cip) return res.fail('CIP es requerido', 400, 'VALIDATION_ERROR');
    const data = await employeeService.toggleStatusByCip(cip, is_active, tenantId(req));
    res.ok(data, `Empleado ${data.is_active ? 'activado' : 'dado de baja'} correctamente`);
  } catch (err) {
    res.fail(err.message, err.status || 500);
  }
});

// ── GET /planilla ─────────────────────────────────────────────────────────
router.get('/planilla', authenticateToken, async (req, res, next) => {
  try {
    res.json(await employeeService.count(tenantId(req)));
  } catch (err) {
    next(err);
  }
});

// ── GET /search ───────────────────────────────────────────────────────────
router.get('/search',
  authenticateToken,
  checkPermission('employees', 'read'),
  [query('q').optional().isLength({ min: 2 }).withMessage('Mínimo 2 caracteres')],
  validate,
  async (req, res) => {
    try {
      res.ok(await employeeService.search(req.query.q || '', 50, tenantId(req)));
    } catch (err) {
      res.fail('Error al buscar empleados');
    }
  }
);

// ── GET / — Listar empleados (API) ────────────────────────────────────────
router.get('/', authenticateToken, checkPermission('employees', 'read'), logActivity('LIST_EMPLOYEES'), async (req, res) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const { employees, total } = await employeeService.findAll({ search, page, limit, tenantId: tenantId(req) });
    res.json({
      success: true,
      data:    employees,
      message: 'OK',
      meta:    { total, page, limit, pages: Math.ceil(total / limit) },
      userPermissions: {
        canCreate: ['administrador', 'editor'].includes(req.user.role),
        canEdit:   ['administrador', 'editor'].includes(req.user.role),
        canDelete: req.user.role === 'administrador',
      },
    });
  } catch (err) {
    res.fail('Error al listar empleados');
  }
});

// ── POST / — Crear empleado ───────────────────────────────────────────────
router.post('/',
  authenticateToken,
  checkPermission('employees', 'create'),
  [
    body('full_name').trim().notEmpty().withMessage('El nombre completo es requerido'),
    body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
    body('cip').optional().trim(),
    body('department_id').optional().isInt().withMessage('Department ID debe ser un número'),
    body('position').optional().trim(),
  ],
  validate,
  logActivity('CREATE_EMPLOYEE'),
  async (req, res) => {
    try {
      const data = await employeeService.create(req.body, tenantId(req));
      res.ok(data, 'Empleado creado exitosamente', 201);
    } catch (err) {
      res.fail(err.message, err.status || 500);
    }
  }
);

// ── PUT /:id — Dar de baja / reactivar ────────────────────────────────────
router.put('/:id', authenticateToken, checkPermission('employees', 'update'), async (req, res) => {
  try {
    const data = await employeeService.setActive(req.params.id, req.body.is_active, req.body.deactivated_at, tenantId(req));
    res.ok(data, 'Empleado actualizado correctamente');
  } catch (err) {
    res.fail(err.message, err.status || 500);
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────
router.delete('/:id',
  authenticateToken,
  checkPermission('employees', 'delete'),
  [param('id').isInt().withMessage('ID debe ser un número entero')],
  validate,
  logActivity('DELETE_EMPLOYEE'),
  async (req, res) => {
    try {
      await employeeService.deleteById(req.params.id, tenantId(req));
      res.ok(null, 'Empleado eliminado exitosamente');
    } catch (err) {
      res.fail(err.message, err.status || 500);
    }
  }
);

module.exports = router;

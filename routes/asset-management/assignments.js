// ============================================================================
// routes/assignments.js - RUTAS PARA ASIGNACIONES DE EQUIPOS (CORREGIDO)
// ============================================================================

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { equipmentPool, callStoredProcedure, executeQuery } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { checkMethodPermission, checkPermission, canEdit } = require('../../middleware/permissions');
const { tenantId } = require('../../src/utils/tenantScope');

// Consulta base de historial (reemplaza los stored procedures legacy, que no
// conocían el tenant y no existen en instalaciones nuevas)
const HISTORY_SELECT = `/* tenant_id: se filtra en cada uso */ SELECT a.id, a.employee_id, a.equipment_id, a.assignment_date, a.return_date, a.status, a.period, a.notes,
                emp.full_name AS employee_name, emp.cip AS employee_cip,
                eq.device_code AS equipment_code, eq.equipment_type, eq.brand, eq.model, eq.serial_number,
                d.department_name, l.location_name
         FROM assignments a
         LEFT JOIN employees   emp ON emp.id = a.employee_id
         LEFT JOIN equipment   eq  ON eq.id  = a.equipment_id
         LEFT JOIN departments d   ON d.id   = a.department_id
         LEFT JOIN locations   l   ON l.id   = a.location_id`;

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ============================================================================
// ⭐ ORDEN CORRECTO DE RUTAS: MÁS ESPECÍFICAS PRIMERO
// ============================================================================

// GET /api/assignments - TODAS las asignaciones activas (ESTA VA PRIMERO)
router.get('/', 
  authenticateToken,
  checkMethodPermission('assignments'), 
  async (req, res, next) => {
    try {
      console.log('📊 GET /api/assignments - Obteniendo todas las asignaciones');
      const tId = tenantId(req);
      const query = `SELECT v.*, v.id AS assignment_id
                     FROM active_assignments_view v
                     JOIN assignments a ON a.id = v.id
                     WHERE a.tenant_id = ?
                     ORDER BY v.assignment_date DESC`;
      const results = await executeQuery(equipmentPool, query, [tId]);

      res.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (error) {
      console.error('❌ Error en GET /api/assignments:', error);
      next(error);
    }
  }
);

// GET /api/assignments/employee/:id - Historial de empleado (ESPECÍFICA)
router.get('/employee/:id',
  authenticateToken,
  checkMethodPermission('assignments'),
  [
    param('id').isInt({ min: 1 }),
    validate
  ],
  async (req, res, next) => {
    try {
      console.log(`📊 GET /api/assignments/employee/${req.params.id}`);
      
      const results = await executeQuery(equipmentPool,
        `${HISTORY_SELECT} WHERE a.employee_id = ? AND a.tenant_id = ? ORDER BY a.assignment_date DESC`,
        [req.params.id, tenantId(req)]);

      res.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (error) {
      console.error('❌ Error en GET /api/assignments/employee/:id:', error);
      next(error);
    }
  }
);

// GET /api/assignments/equipment/:id - Historial de equipo (ESPECÍFICA)
router.get('/equipment/:id',
  authenticateToken,
  checkMethodPermission('assignments'),
  [
    param('id').isInt({ min: 1 }),
    validate
  ],
  async (req, res, next) => {
    try {
      console.log(`📊 GET /api/assignments/equipment/${req.params.id}`);
      
      const results = await executeQuery(equipmentPool,
        `${HISTORY_SELECT} WHERE a.equipment_id = ? AND a.tenant_id = ? ORDER BY a.assignment_date DESC`,
        [req.params.id, tenantId(req)]);

      res.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (error) {
      console.error('❌ Error en GET /api/assignments/equipment/:id:', error);
      next(error);
    }
  }
);

// GET /api/assignments/period/:period - Asignaciones por periodo (ESPECÍFICA)
router.get('/period/:period',
  authenticateToken,
  checkMethodPermission('assignments'),
  [
    param('period').matches(/^\d{6}$/),
    validate
  ],
  async (req, res, next) => {
    try {
      console.log(`📊 GET /api/assignments/period/${req.params.period}`);
      
      const results = await executeQuery(equipmentPool,
        `${HISTORY_SELECT} WHERE a.period = ? AND a.tenant_id = ? ORDER BY a.assignment_date DESC`,
        [req.params.period, tenantId(req)]);

      res.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (error) {
      console.error('❌ Error en GET /api/assignments/period/:period:', error);
      next(error);
    }
  }
);

// GET /api/assignments/:id - Buscar por CIP de empleado (ESTA VA AL FINAL)
router.get('/:id',
  authenticateToken,
  checkMethodPermission('assignments'),
  async (req, res, next) => {
    try {
      console.log(`📊 GET /api/assignments/${req.params.id} (CIP search)`);
      
      const tId2 = tenantId(req);
      const query = `
        SELECT v.*
        FROM active_assignments_view v
        JOIN assignments a ON a.id = v.id
        WHERE v.employee_cip = ? AND a.tenant_id = ?
        ORDER BY v.assignment_date DESC
      `;
      const results = await executeQuery(equipmentPool, query, [req.params.id, tId2]);
      
      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No se encontraron asignaciones para este empleado'
        });
      }

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      console.error('❌ Error en GET /api/assignments/:id:', error);
      next(error);
    }
  }
);

// ============================================================================
// POST /api/assignments - Asignar equipo a empleado
// ============================================================================
router.post('/',
  authenticateToken,
  checkMethodPermission('assignments'),
  async (req, res, next) => {
    try {
      let { employee_id, employee_cip, equipment_id, equipment_code, assignment_date, department_id, location_id } = req.body;

      console.log('📝 POST /api/assignments - Body:', req.body);

      // PASO 1: Resolver employee_id
      if (!employee_id && employee_cip) {
        // Buscar por CIP sin filtro is_active (permite empleados de baja)
        const empResult = await executeQuery(equipmentPool,
          'SELECT id, full_name FROM employees WHERE cip = ? AND tenant_id = ? LIMIT 1',
          [employee_cip, tenantId(req)]
        );
        if (!empResult.length) {
          return res.status(404).json({ success: false, message: `No se encontró empleado con CIP: ${employee_cip}` });
        }
        employee_id = empResult[0].id;
        console.log('✅ employee_id resuelto por CIP:', employee_id, empResult[0].full_name);
      }

      // PASO 2: Resolver equipment_id
      if (!equipment_id && equipment_code) {
        const eqResult = await executeQuery(equipmentPool,
          'SELECT id, model, status FROM equipment WHERE device_code = ? AND tenant_id = ? LIMIT 1',
          [equipment_code, tenantId(req)]
        );
        if (!eqResult.length) {
          return res.status(404).json({ success: false, message: `No se encontró equipo con código: ${equipment_code}` });
        }
if (eqResult[0].status !== 'Disponible') {
  return res.status(400).json({ 
    success: false, 
    message: `El equipo no está disponible (Estado: ${eqResult[0].status})` 
  });
}
        equipment_id = eqResult[0].id;
        console.log('✅ equipment_id resuelto por código:', equipment_id, eqResult[0].model);
      }

      // PASO 3: Validar que tenemos ambos IDs
      if (!employee_id || !equipment_id) {
        console.log('❌ Faltan IDs - employee_id:', employee_id, 'equipment_id:', equipment_id);
        return res.status(400).json({
          success: false,
          message: 'Se requiere employee_id o employee_cip, y equipment_id o equipment_code'
        });
      }

      // Los IDs enviados directamente también deben pertenecer al tenant
      const [ownEmp] = await executeQuery(equipmentPool, 'SELECT id FROM employees WHERE id = ? AND tenant_id = ?', [employee_id, tenantId(req)]);
      const [ownEq]  = await executeQuery(equipmentPool, 'SELECT id FROM equipment WHERE id = ? AND tenant_id = ?', [equipment_id, tenantId(req)]);
      if (!ownEmp || !ownEq) return res.status(404).json({ success: false, message: 'Empleado o equipo no encontrado' });

      // PASO 4: Verificar que el equipo no tenga asignación activa real (employee_id != 0)
      const activeCheck = await executeQuery(equipmentPool,
        'SELECT id FROM assignments WHERE equipment_id = ? AND return_date IS NULL AND employee_id != 0 AND tenant_id = ? LIMIT 1',
        [equipment_id, tenantId(req)]
      );
      if (activeCheck.length > 0) {
        return res.status(400).json({ success: false, message: 'Este equipo ya tiene una asignación activa' });
      }

      // PASO 5: Crear la asignación
      const result = await executeQuery(equipmentPool,
        'INSERT INTO assignments (employee_id, equipment_id, assignment_date, department_id, location_id, tenant_id) VALUES (?, ?, ?, ?, ?, ?)',
        [employee_id, equipment_id, assignment_date, department_id || null, location_id || null, tenantId(req)]
      );
      console.log('✅ Asignación creada ID:', result.insertId);

      // PASO 6: Actualizar estado del equipo
      await executeQuery(equipmentPool, 'UPDATE equipment SET status = ? WHERE id = ? AND tenant_id = ?', ['Asignado', equipment_id, tenantId(req)]);

      res.status(201).json({
        success: true,
        message: 'Equipo asignado exitosamente',
        data: { id: result.insertId, employee_id, equipment_id, assignment_date }
      });

    } catch (error) {
      console.error('❌ Error en POST /api/assignments:', error);
      next(error);
    }
  }
);

// ============================================================================
// PUT /api/assignments/update - Actualizar asignación COMPLETA
// ============================================================================
router.put('/update',
  authenticateToken,
  checkMethodPermission('assignments'), 
  async (req, res) => {
    const {
        assignment_id,
        employee_cip,
        employee_name,
        equipment_code,
        department_id,
        location_id,
        assignment_date
    } = req.body;

    console.log('═══════════════════════════════════════════════');
    console.log('📥 PUT /api/assignments/update');
    console.log('Assignment ID:', assignment_id);
    console.log('Employee CIP:', employee_cip);
    console.log('Employee Name:', employee_name);
    console.log('Equipment Code:', equipment_code);
    console.log('Department ID:', department_id);
    console.log('Location ID:', location_id);
    console.log('Assignment Date:', assignment_date);
    console.log('═══════════════════════════════════════════════');

    try {
        if (!assignment_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'El ID de asignación es requerido' 
            });
        }

        const beforeQuery = `
            SELECT a.*, e.full_name as employee_name, e.cip as employee_cip,
                   eq.device_code as equipment_code,
                   d.department_name, l.location_name
            FROM assignments a
            LEFT JOIN employees e ON a.employee_id = e.id
            LEFT JOIN equipment eq ON a.equipment_id = eq.id
            LEFT JOIN departments d ON a.department_id = d.id
            LEFT JOIN locations l ON a.location_id = l.id
            WHERE a.id = ? AND a.tenant_id = ?
        `;
        const before = await executeQuery(equipmentPool, beforeQuery, [assignment_id, tenantId(req)]);
        if (!before.length) return res.status(404).json({ success: false, message: 'No se encontró la asignación.' });
        console.log('📊 Estado ANTES:', before[0]);

        let employee_id = before[0].employee_id;
        let equipment_id = before[0].equipment_id;
        let updatesMade = [];

        // PASO 1: Actualizar nombre del empleado si cambió
        if (employee_name && employee_cip) {
            const updateEmployeeQuery = `
                UPDATE employees
                SET full_name = ?
                WHERE cip = ? AND tenant_id = ?
            `;
            
            const empResult = await executeQuery(
                equipmentPool,
                updateEmployeeQuery,
                [employee_name.trim(), employee_cip, tenantId(req)]
            );
            
            if (empResult.affectedRows > 0) {
                updatesMade.push('nombre de empleado');
                console.log('👤 Empleado actualizado:', {
                    affectedRows: empResult.affectedRows,
                    cip: employee_cip,
                    newName: employee_name
                });
            }
        }

        // PASO 2: Obtener nuevo employee_id si cambió el CIP
        if (employee_cip && employee_cip !== before[0].employee_cip) {
            const empQuery = 'SELECT id FROM employees WHERE cip = ? AND tenant_id = ?';
            const empResult = await executeQuery(equipmentPool, empQuery, [employee_cip, tenantId(req)]);
            if (empResult.length > 0) {
                employee_id = empResult[0].id;
                updatesMade.push('empleado');
                console.log('🔄 Nuevo employee_id:', employee_id);
            } else {
                return res.status(404).json({
                    success: false,
                    message: `No se encontró el empleado con CIP: ${employee_cip}`
                });
            }
        }

        // PASO 3: Obtener nuevo equipment_id si cambió el código
        if (equipment_code && equipment_code !== before[0].equipment_code) {
            const eqQuery = 'SELECT id FROM equipment WHERE device_code = ? AND tenant_id = ?';
            const eqResult = await executeQuery(equipmentPool, eqQuery, [equipment_code, tenantId(req)]);
            if (eqResult.length > 0) {
                equipment_id = eqResult[0].id;
                updatesMade.push('equipo');
                console.log('🔄 Nuevo equipment_id:', equipment_id);
            } else {
                return res.status(404).json({
                    success: false,
                    message: `No se encontró el equipo con código: ${equipment_code}`
                });
            }
        }

        // PASO 4: Actualizar la asignación
        const query = `
            UPDATE assignments
            SET 
                employee_id = ?,
                equipment_id = ?,
                department_id = ?,
                location_id = ?,
                assignment_date = ?,
                updated_at = NOW()
            WHERE id = ? AND tenant_id = ?
        `;

        const result = await executeQuery(
            equipmentPool, 
            query, 
            [employee_id, equipment_id, department_id, location_id, assignment_date, assignment_id, tenantId(req)]
        );

        console.log('✅ UPDATE result:', {
            affectedRows: result.affectedRows,
            changedRows: result.changedRows
        });

        const afterQuery = `
            SELECT a.*, e.full_name as employee_name, e.cip as employee_cip,
                   eq.device_code as equipment_code,
                   d.department_name, l.location_name
            FROM assignments a
            LEFT JOIN employees e ON a.employee_id = e.id
            LEFT JOIN equipment eq ON a.equipment_id = eq.id
            LEFT JOIN departments d ON a.department_id = d.id
            LEFT JOIN locations l ON a.location_id = l.id
            WHERE a.id = ? AND a.tenant_id = ?
        `;
        const after = await executeQuery(equipmentPool, afterQuery, [assignment_id, tenantId(req)]);
        console.log('📊 Estado DESPUÉS:', after[0]);
        console.log('═══════════════════════════════════════════════\n');

        if (result.affectedRows > 0) {
            const message = updatesMade.length > 0 
                ? `Asignación actualizada correctamente (${updatesMade.join(', ')}, departamento, ubicación y fecha).`
                : 'Asignación actualizada correctamente.';
            
            res.json({ 
                success: true, 
                message: message,
                changedRows: result.changedRows,
                updates: updatesMade
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'No se encontró la asignación.' 
            });
        }
    } catch (error) {
        console.error('❌ Error completo:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================================================
// PUT /api/assignments/:id/return - Devolver equipo
// ============================================================================
router.put('/:id/return',
  authenticateToken,
  checkMethodPermission('assignments'),
  [
    param('id').isInt({ min: 1 }).withMessage('ID de asignación inválido'),
    validate
  ],
  async (req, res, next) => {
    try {
      console.log(`📦 PUT /api/assignments/${req.params.id}/return`);
      
      const tid = tenantId(req);
      const [asg] = await executeQuery(equipmentPool,
        'SELECT id, equipment_id FROM assignments WHERE id = ? AND tenant_id = ? AND return_date IS NULL', [req.params.id, tid]);
      if (!asg) return res.status(404).json({ success: false, message: 'Asignación activa no encontrada' });
      await executeQuery(equipmentPool,
        "UPDATE assignments SET return_date = CURDATE(), status = 'Finalizado', updated_at = NOW() WHERE id = ? AND tenant_id = ?", [asg.id, tid]);
      await executeQuery(equipmentPool,
        "UPDATE equipment SET status = 'Disponible' WHERE id = ? AND tenant_id = ?", [asg.equipment_id, tid]);

      res.json({
        success: true,
        message: 'Equipo devuelto exitosamente',
        data: { assignment_id: asg.id, equipment_id: asg.equipment_id }
      });
    } catch (error) {
      console.error('❌ Error en PUT /api/assignments/:id/return:', error);
      next(error);
    }
  }
);

// ============================================================================
// POST /api/assignments/:id/transfer - Transferir equipo
// ============================================================================
router.post('/:id/transfer',
  authenticateToken,
  checkMethodPermission('assignments'),
  [
    param('id').isInt({ min: 1 }),
    body('new_employee_id').isInt({ min: 1 }),
    body('period').matches(/^\d{6}$/),
    validate
  ],
  async (req, res, next) => {
    try {
      console.log(`🔄 POST /api/assignments/${req.params.id}/transfer`);
      
      const { new_employee_id, new_department_id, new_location_id, period } = req.body;

      const tid = tenantId(req);
      const [asg] = await executeQuery(equipmentPool,
        'SELECT id, equipment_id FROM assignments WHERE id = ? AND tenant_id = ? AND return_date IS NULL', [req.params.id, tid]);
      const [emp] = await executeQuery(equipmentPool, 'SELECT id FROM employees WHERE id = ? AND tenant_id = ?', [new_employee_id, tid]);
      if (!asg || !emp) return res.status(404).json({ success: false, message: 'Asignación o empleado no encontrado' });

      // Cierra la asignación actual y abre una nueva para el nuevo empleado
      await executeQuery(equipmentPool,
        "UPDATE assignments SET return_date = CURDATE(), status = 'Finalizado', updated_at = NOW() WHERE id = ? AND tenant_id = ?", [asg.id, tid]);
      const created = await executeQuery(equipmentPool,
        `INSERT INTO assignments (employee_id, equipment_id, department_id, location_id, period, assignment_date, status, tenant_id)
         VALUES (?, ?, ?, ?, ?, CURDATE(), 'Activo', ?)`,
        [new_employee_id, asg.equipment_id, new_department_id || null, new_location_id || null, period, tid]);

      res.json({
        success: true,
        message: 'Equipo transferido exitosamente',
        data: { previous_assignment_id: asg.id, new_assignment_id: created.insertId, equipment_id: asg.equipment_id }
      });
    } catch (error) {
      console.error('❌ Error en POST /api/assignments/:id/transfer:', error);
      next(error);
    }
  }
);

module.exports = router;
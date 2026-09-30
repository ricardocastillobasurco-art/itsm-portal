// ============================================================================
// routes/indicators.js - RUTAS PARA INDICADORES Y REPORTES
// ============================================================================

const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { tenantId } = require('../../src/utils/tenantScope');

// ============================================================================
// FUNCIÓN AUXILIAR: CONSTRUIR WHERE CLAUSE CON FILTROS
// ============================================================================
function buildWhereClause(filters, tid) {
    const conditions = [`a.tenant_id = ${Number(tid)}`];
    const params = [];
    
    // Filtro de fechas
    if (filters.startDate && filters.endDate) {
        conditions.push('a.assignment_date BETWEEN ? AND ?');
        params.push(filters.startDate, filters.endDate);
    }
    
    // Filtro de tipo de equipo
    if (filters.equipmentType) {
        conditions.push('e.equipment_type = ?');
        params.push(filters.equipmentType);
    }
    
    // Filtro de estado
    if (filters.status) {
        conditions.push('e.status = ?');
        params.push(filters.status);
    }
    
    // Filtro de departamento
    if (filters.department) {
        conditions.push('a.department_id = ?');
        params.push(filters.department);
    }
    
    // Filtro de ubicación
    if (filters.location) {
        conditions.push('a.location_id = ?');
        params.push(filters.location);
    }
    
    // Filtro de marca
    if (filters.brand) {
        conditions.push('e.brand = ?');
        params.push(filters.brand);
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    return { whereClause, params };
}

// ============================================================================
// GET /api/indicators/metrics - MÉTRICAS GENERALES
// ============================================================================
router.get('/metrics', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            status: req.query.status,
            department: req.query.department,
            location: req.query.location,
            brand: req.query.brand
        };
        
        const { whereClause, params } = buildWhereClause(filters, tenantId(req));
        
        // Query base sin filtros para totales generales
        const totalEmployeesQuery = 'SELECT COUNT(*) as total FROM employees WHERE is_active = TRUE AND tenant_id = ?';
        const totalEquipmentQuery = 'SELECT COUNT(*) as total FROM equipment WHERE tenant_id = ?';
        
        // Query con filtros para asignaciones
        const assignmentsQuery = `
            SELECT COUNT(DISTINCT a.id) as total /* tenant_id: en whereClause */
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            ${whereClause}
            AND a.status = 'Activo' AND a.return_date IS NULL
        `;
        
        const [employeesResult, equipmentResult, assignmentsResult] = await Promise.all([
            executeQuery(equipmentPool, totalEmployeesQuery, [tenantId(req)]),
            executeQuery(equipmentPool, totalEquipmentQuery, [tenantId(req)]),
            executeQuery(equipmentPool, assignmentsQuery, params)
        ]);
        
        res.json({
            success: true,
            data: {
                totalEmployees: employeesResult[0].total,
                totalEquipment: equipmentResult[0].total,
                activeAssignments: assignmentsResult[0].total,
                filtersApplied: params.length > 0
            }
        });
        
    } catch (error) {
        console.error('Error en /metrics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/assignments-timeline - LÍNEA DE TIEMPO DE ASIGNACIONES
// ============================================================================
router.get('/assignments-timeline', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            status: req.query.status,
            department: req.query.department,
            location: req.query.location,
            brand: req.query.brand
        };
        
        const { whereClause, params } = buildWhereClause(filters, tenantId(req));
        
        const query = `
            SELECT /* tenant_id: en whereClause */
                DATE_FORMAT(a.assignment_date, '%Y-%m') as month,
                DATE_FORMAT(a.assignment_date, '%b %Y') as month_label,
                COUNT(DISTINCT a.id) as total_assignments,
                COUNT(DISTINCT CASE WHEN e.equipment_type = 'Laptop' THEN a.id END) as laptops,
                COUNT(DISTINCT CASE WHEN e.equipment_type = 'Desktop' THEN a.id END) as desktops,
                COUNT(DISTINCT CASE WHEN e.equipment_type = 'Monitor' THEN a.id END) as monitors,
                COUNT(DISTINCT CASE WHEN e.equipment_type = 'Tablet' THEN a.id END) as tablets
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            ${whereClause}
            GROUP BY DATE_FORMAT(a.assignment_date, '%Y-%m'), DATE_FORMAT(a.assignment_date, '%b %Y')
            ORDER BY month DESC
            LIMIT 12
        `;
        
        const results = await executeQuery(equipmentPool, query, params);
        
        // Invertir para mostrar cronológicamente
        const data = results.reverse();
        
        // Preparar datos para el gráfico
        const chartData = {
            labels: data.map(row => row.month_label),
            datasets: [{
                label: 'Asignaciones',
                data: data.map(row => row.total_assignments)
            }]
        };
        
        res.json({
            success: true,
            data: chartData,
            raw: data
        });
        
    } catch (error) {
        console.error('Error en /assignments-timeline:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/equipment-by-status - EQUIPOS POR ESTADO
// ============================================================================
router.get('/equipment-by-status', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            status: req.query.status,
            department: req.query.department,
            location: req.query.location,
            brand: req.query.brand
        };
        
        // Para este endpoint, construimos un WHERE diferente (sin tabla assignments)
        const conditions = [`e.tenant_id = ${Number(tenantId(req))}`];
        const params = [];
        
        if (filters.equipmentType) {
            conditions.push('e.equipment_type = ?');
            params.push(filters.equipmentType);
        }
        
        if (filters.status) {
            conditions.push('e.status = ?');
            params.push(filters.status);
        }
        
        if (filters.brand) {
            conditions.push('e.brand = ?');
            params.push(filters.brand);
        }
        
        // Si hay filtro de fecha, departamento o ubicación, necesitamos JOIN
        let joinClause = '';
        let additionalConditions = '';
        
        if (filters.startDate || filters.endDate || filters.department || filters.location) {
            joinClause = 'LEFT JOIN assignments a ON e.id = a.equipment_id AND a.status = "Activo" AND a.return_date IS NULL';
            
            if (filters.startDate && filters.endDate) {
                conditions.push('a.assignment_date BETWEEN ? AND ?');
                params.push(filters.startDate, filters.endDate);
            }
            
            if (filters.department) {
                conditions.push('a.department_id = ?');
                params.push(filters.department);
            }
            
            if (filters.location) {
                conditions.push('a.location_id = ?');
                params.push(filters.location);
            }
        }
        
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        
        const query = `
            SELECT /* tenant_id: en whereClause */
                e.status,
                COUNT(DISTINCT e.id) as total,
                ROUND(COUNT(DISTINCT e.id) * 100.0 / 
                    (SELECT COUNT(*) FROM equipment WHERE tenant_id = ${Number(tenantId(req))}), 2) as percentage
            FROM equipment e
            ${joinClause}
            ${whereClause}
            GROUP BY e.status
            ORDER BY total DESC
        `;
        
        const results = await executeQuery(equipmentPool, query, params);
        
        res.json({
            success: true,
            data: {
                summary: results,
                total: results.reduce((sum, row) => sum + row.total, 0)
            }
        });
        
    } catch (error) {
        console.error('Error en /equipment-by-status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/equipment-distribution - DISTRIBUCIÓN DE EQUIPOS
// ============================================================================
router.get('/equipment-distribution', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            status: req.query.status,
            department: req.query.department,
            location: req.query.location,
            brand: req.query.brand
        };
        
        const conditions = [`tenant_id = ${Number(tenantId(req))}`];
        const params = [];
        
        if (filters.equipmentType) {
            conditions.push('equipment_type = ?');
            params.push(filters.equipmentType);
        }
        
        if (filters.status) {
            conditions.push('status = ?');
            params.push(filters.status);
        }
        
        if (filters.brand) {
            conditions.push('brand = ?');
            params.push(filters.brand);
        }
        
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        
        const query = `
            SELECT 
                equipment_type,
                COUNT(*) as total,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM equipment /* tenant_id: en whereClause */ ${whereClause}), 2) as percentage
            FROM equipment
            ${whereClause}
            GROUP BY equipment_type
            ORDER BY total DESC
        `;
        
        const results = await executeQuery(equipmentPool, query, params);
        
        // Preparar datos para gráfico de dona
        const chartData = {
            labels: results.map(row => row.equipment_type),
            datasets: [{
                data: results.map(row => row.total),
                percentages: results.map(row => row.percentage)
            }]
        };
        
        res.json({
            success: true,
            data: chartData
        });
        
    } catch (error) {
        console.error('Error en /equipment-distribution:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/assignment-rate - TASA DE ASIGNACIÓN
// ============================================================================
router.get('/assignment-rate', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            brand: req.query.brand
        };
        
        const conditions = [`tenant_id = ${Number(tenantId(req))}`];
        const params = [];
        
        if (filters.equipmentType) {
            conditions.push('equipment_type = ?');
            params.push(filters.equipmentType);
        }
        
        if (filters.brand) {
            conditions.push('brand = ?');
            params.push(filters.brand);
        }
        
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        
        const query = `
            SELECT /* tenant_id: en whereClause */
                COUNT(*) as total_equipment,
                SUM(CASE WHEN status = 'Asignado' THEN 1 ELSE 0 END) as assigned,
                ROUND(SUM(CASE WHEN status = 'Asignado' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as rate
            FROM equipment
            ${whereClause}
        `;
        
        const results = await executeQuery(equipmentPool, query, params);
        
        res.json({
            success: true,
            data: {
                total: results[0].total_equipment,
                assigned: results[0].assigned,
                rate: results[0].rate || 0
            }
        });
        
    } catch (error) {
        console.error('Error en /assignment-rate:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/assignments-detailed - ASIGNACIONES DETALLADAS
// ============================================================================
router.get('/assignments-detailed', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            status: req.query.status,
            department: req.query.department,
            location: req.query.location,
            brand: req.query.brand
        };
        
        const limit = parseInt(req.query.limit) || 50;
        
        const { whereClause, params } = buildWhereClause(filters, tenantId(req));
        
        const query = `
            SELECT /* tenant_id: en whereClause */
                a.id as assignment_id,
                emp.full_name as employee_name,
                emp.cip as employee_cip,
                e.device_code as equipment_code,
                e.brand,
                e.model,
                e.equipment_type,
                e.status as equipment_status,
                d.department_name,
                l.location_name,
                l.city,
                a.assignment_date,
                DATEDIFF(CURDATE(), a.assignment_date) as days_assigned
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            INNER JOIN employees emp ON a.employee_id = emp.id
            LEFT JOIN departments d ON a.department_id = d.id
            LEFT JOIN locations l ON a.location_id = l.id
            ${whereClause}
            AND a.status = 'Activo' AND a.return_date IS NULL
            ORDER BY a.assignment_date DESC
            LIMIT ?
        `;
        
        params.push(limit);
        
        const results = await executeQuery(equipmentPool, query, params);
        
        res.json({
            success: true,
            data: results,
            count: results.length,
            filtersApplied: params.length > 1
        });
        
    } catch (error) {
        console.error('Error en /assignments-detailed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/comparison-data - DATOS PARA COMPARACIÓN DE PERÍODOS
// ============================================================================
router.get('/comparison-data', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            department: req.query.department,
            location: req.query.location
        };
        
        const { whereClause, params } = buildWhereClause(filters, tenantId(req));
        
        const query = `
            SELECT /* tenant_id: en whereClause */
                COUNT(DISTINCT a.id) as total_assignments,
                COUNT(DISTINCT CASE WHEN a.assignment_date BETWEEN ? AND ? THEN e.id END) as new_equipment,
                COUNT(DISTINCT CASE WHEN a.return_date BETWEEN ? AND ? THEN a.id END) as returns,
                COUNT(DISTINCT CASE WHEN e.status = 'Mantenimiento' THEN e.id END) as maintenance
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            ${whereClause}
        `;
        
        const periodParams = [filters.startDate, filters.endDate, filters.startDate, filters.endDate, ...params];
        
        const results = await executeQuery(equipmentPool, query, periodParams);
        
        res.json({
            success: true,
            data: results[0]
        });
        
    } catch (error) {
        console.error('Error en /comparison-data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/indicators/export-data - EXPORTAR DATOS
// ============================================================================
router.get('/export-data', authenticateToken, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            equipmentType: req.query.equipmentType,
            status: req.query.status,
            department: req.query.department,
            location: req.query.location,
            brand: req.query.brand
        };
        
        const { whereClause, params } = buildWhereClause(filters, tenantId(req));
        
        // Query de asignaciones
        const assignmentsQuery = `
            SELECT /* tenant_id: en whereClause */
                a.id,
                emp.full_name as employee,
                emp.cip,
                e.device_code,
                e.equipment_type,
                e.brand,
                e.model,
                d.department_name,
                l.location_name,
                a.assignment_date,
                DATEDIFF(CURDATE(), a.assignment_date) as days_assigned
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            INNER JOIN employees emp ON a.employee_id = emp.id
            LEFT JOIN departments d ON a.department_id = d.id
            LEFT JOIN locations l ON a.location_id = l.id
            ${whereClause}
            AND a.status = 'Activo' AND a.return_date IS NULL
            ORDER BY a.assignment_date DESC
        `;
        
        // Query de equipos por estado
        const statusQuery = `
            SELECT 
                e.status,
                COUNT(*) as total
            FROM equipment e
            WHERE e.tenant_id = ${Number(tenantId(req))}
            GROUP BY e.status
        `;
        
        const [assignments, equipmentByStatus] = await Promise.all([
            executeQuery(equipmentPool, assignmentsQuery, params),
            executeQuery(equipmentPool, statusQuery)
        ]);
        
        res.json({
            success: true,
            data: {
                assignments,
                equipmentByStatus
            }
        });
        
    } catch (error) {
        console.error('Error en /export-data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');

// ID del tenant primario (Integratel) — sus datos viven en las tablas legacy sin tenant_id
const PRIMARY_TENANT_ID = 1;

// Endpoint ultrarrápido - SOLO estadísticas
router.get('/stats-only', authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        const isPrimary = !tenantId || parseInt(tenantId) === PRIMARY_TENANT_ID;

        // Tenants no-primarios: tablas legacy no tienen tenant_id, devolver ceros
        if (!isPrimary) {
            return res.json({
                success: true,
                stats: { totalEmployees: 0, totalEquipment: 0, totalAssignments: 0, totalDepartments: 0, totalLocations: 0 },
                timestamp: new Date(),
                cached: false,
            });
        }

        // Tenant primario: leer de caché
        const cached = await executeQuery(equipmentPool, 'SELECT * FROM dashboard_stats_cache WHERE id = 1');
        if (cached.length > 0) {
            const stats = cached[0];
            const cacheAge = Date.now() - new Date(stats.last_updated).getTime();
            if (cacheAge < 5 * 60 * 1000) {
                return res.json({
                    success: true,
                    stats: {
                        totalEmployees:   stats.total_employees,
                        totalEquipment:   stats.total_equipment,
                        totalAssignments: stats.total_assignments,
                        totalDepartments: stats.total_departments,
                        totalLocations:   stats.total_locations,
                    },
                    timestamp: stats.last_updated,
                    cached: true,
                });
            }
        }

        executeQuery(equipmentPool, 'CALL refresh_dashboard_stats()').catch(console.error);

        const [employees, equipment, assignments, departments, locations] = await Promise.all([
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM employees WHERE is_active = 1'),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM equipment'),
            executeQuery(equipmentPool, "SELECT COUNT(*) as count FROM assignments WHERE status = 'Activo'"),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM departments WHERE is_active = 1'),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM locations WHERE is_active = 1'),
        ]);

        res.json({
            success: true,
            stats: {
                totalEmployees:   employees[0].count,
                totalEquipment:   equipment[0].count,
                totalAssignments: assignments[0].count,
                totalDepartments: departments[0].count,
                totalLocations:   locations[0].count,
            },
            timestamp: new Date(),
            cached: false,
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
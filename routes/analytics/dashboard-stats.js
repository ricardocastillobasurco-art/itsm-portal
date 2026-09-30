const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { tenantId } = require('../../src/utils/tenantScope');

// Endpoint ultrarrápido - SOLO estadísticas del tenant (conteos en vivo)
router.get('/stats-only', authenticateToken, async (req, res) => {
    try {
        const tid = tenantId(req);
        const [employees, equipment, assignments, departments, locations] = await Promise.all([
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM employees WHERE is_active = 1 AND tenant_id = ?', [tid]),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM equipment WHERE tenant_id = ?', [tid]),
            executeQuery(equipmentPool, "SELECT COUNT(*) as count FROM assignments WHERE status = 'Activo' AND tenant_id = ?", [tid]),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM departments WHERE is_active = 1 AND tenant_id = ?', [tid]),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM locations WHERE is_active = 1 AND tenant_id = ?', [tid]),
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

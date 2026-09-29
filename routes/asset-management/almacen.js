// ============================================================================
// routes/almacen.js — Módulo Almacén
// Equipos disponibles · Fallas técnicas · Traslados
// ============================================================================
const express  = require('express');
const router   = express.Router();
const { equipmentPool, executeQuery } = require('../../config/database');
const { authenticateToken }           = require('../../middleware/auth');
const { tenantId }                    = require('../../src/utils/tenantScope');

// Todos los endpoints requieren auth
router.use(authenticateToken);

// ─── Helper ──────────────────────────────────────────────────────────────────
const ok  = (res, data, extra = {}) => res.json({ success: true,  ...extra, data });
const err = (res, msg, code = 500)  => res.status(code).json({ success: false, error: msg });

// ============================================================================
// KPIs — GET /api/almacen/stats
// Devuelve conteos de equipos Disponibles agrupados por tipo
// ============================================================================
router.get('/stats', async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool, `
            SELECT
                equipment_type                                                        AS tipo,
                COUNT(*)                                                              AS total,
                SUM(warranty_months IS NOT NULL
                    AND DATE_ADD(created_at, INTERVAL warranty_months MONTH) >= CURDATE()) AS en_garantia
            FROM equipment
            WHERE status = 'Disponible' AND tenant_id = ?
            GROUP BY equipment_type
            ORDER BY equipment_type
        `, [tenantId(req)]);

        // Totales globales
        const totals = await executeQuery(equipmentPool, `
            SELECT COUNT(*) AS total_disponibles
            FROM equipment
            WHERE status = 'Disponible' AND tenant_id = ?
        `, [tenantId(req)]);

        // Fallas abiertas
        const fallas = await executeQuery(equipmentPool, `
            SELECT COUNT(*) AS total_fallas
            FROM equipment_faults
            WHERE repair_status NOT IN ('Resuelto','Dado de baja') AND tenant_id = ?
        `, [tenantId(req)]);

        // Traslados este mes
        const traslados = await executeQuery(equipmentPool, `
            SELECT COUNT(*) AS traslados_mes
            FROM equipment_transfers
            WHERE YEAR(transfer_date) = YEAR(CURDATE())
              AND MONTH(transfer_date) = MONTH(CURDATE())
              AND tenant_id = ?
        `, [tenantId(req)]);

        ok(res, {
            porTipo:           rows,
            totalDisponibles:  totals[0].total_disponibles,
            fallasPendientes:  fallas[0].total_fallas,
            trasladosMes:      traslados[0].traslados_mes,
        });
    } catch (e) {
        console.error('❌ [almacen/stats]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// EQUIPOS DISPONIBLES — GET /api/almacen/disponibles
// Query params: tipo, search, page, limit
// ============================================================================
router.get('/disponibles', async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page  || 1));
        const limit  = Math.min(100, parseInt(req.query.limit || 25));
        const offset = (page - 1) * limit;
        const tipo   = req.query.tipo   || null;
        const search = req.query.search || null;

        let where  = ['e.status = "Disponible"', 'e.tenant_id = ?'];
        let params = [tenantId(req)];

        if (tipo) {
            where.push('e.equipment_type = ?');
            params.push(tipo);
        }
        if (search) {
            where.push('(e.device_code LIKE ? OR e.brand LIKE ? OR e.model LIKE ? OR e.serial_number LIKE ?)');
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        const whereStr = 'WHERE ' + where.join(' AND ');

        const [rows, total] = await Promise.all([
            executeQuery(equipmentPool, `
                SELECT /* tenant_id: filtrado en whereStr */
                    e.id, e.device_code, e.serial_number, e.equipment_type,
                    e.brand, e.model, e.status, e.acquisition_type,
                    e.warranty_months, e.obsolescence_years,
                    e.processor, e.ram_memory, e.disk_capacity,
                    COALESCE(e.operating_system, s.sistema_operativo) AS operating_system,
                    COALESCE(e.domain, s.dominio)                     AS domain,
                    DATE_ADD(e.created_at, INTERVAL COALESCE(e.warranty_months, 0) MONTH) AS warranty_expiry_calc,
                    e.created_at
                FROM equipment e
                LEFT JOIN sccm_inventory s ON s.tenant_id = e.tenant_id AND (s.hostname COLLATE utf8mb4_0900_ai_ci = e.device_code OR s.bios_serial COLLATE utf8mb4_0900_ai_ci = e.serial_number)
                ${whereStr}
                ORDER BY e.equipment_type, e.brand, e.model
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]),

            executeQuery(equipmentPool, `
                SELECT COUNT(*) AS total /* tenant_id: filtrado en whereStr */
                FROM equipment e
                ${whereStr}
            `, params),
        ]);

        ok(res, rows, {
            pagination: {
                total:    total[0].total,
                page,
                limit,
                pages:    Math.ceil(total[0].total / limit),
            }
        });
    } catch (e) {
        console.error('❌ [almacen/disponibles]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// DETALLE DE UN EQUIPO — GET /api/almacen/disponibles/:id
// ============================================================================
router.get('/disponibles/:id', async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool, `
            SELECT e.*,
                   COALESCE(e.operating_system, s.sistema_operativo) AS operating_system,
                   COALESCE(e.domain, s.dominio)                     AS domain,
                   DATE_ADD(e.created_at, INTERVAL COALESCE(e.warranty_months, 0) MONTH) AS warranty_expiry_calc
            FROM equipment e
            LEFT JOIN sccm_inventory s ON s.tenant_id = e.tenant_id AND (s.hostname COLLATE utf8mb4_0900_ai_ci = e.device_code OR s.bios_serial COLLATE utf8mb4_0900_ai_ci = e.serial_number)
            WHERE e.id = ? AND e.tenant_id = ?
        `, [req.params.id, tenantId(req)]);

        if (!rows.length) return err(res, 'Equipo no encontrado', 404);
        ok(res, rows[0]);
    } catch (e) {
        err(res, e.message);
    }
});

// ============================================================================
// CREAR EQUIPO — POST /api/almacen/equipment
// Mismo contrato que POST /api/equipment
// ============================================================================
router.post('/equipment', async (req, res) => {
    try {
        const {
            device_code, serial_number, equipment_type, brand, model,
            ram_memory, disk_capacity, processor, operating_system,
            acquisition_type, warranty_months, obsolescence_years, domain, status,
        } = req.body;

        if (!device_code || !equipment_type || !brand || !model) {
            return err(res, 'Campos requeridos: device_code, equipment_type, brand, model', 400);
        }

        // Código duplicado
        const dup = await executeQuery(equipmentPool,
            'SELECT id FROM equipment WHERE device_code = ? AND tenant_id = ? LIMIT 1', [device_code, tenantId(req)]);
        if (dup.length) return err(res, `El código "${device_code}" ya existe`, 409);

        const result = await executeQuery(equipmentPool, `
            INSERT INTO equipment
                (device_code, serial_number, equipment_type, brand, model,
                 ram_memory, disk_capacity, processor, operating_system,
                 acquisition_type, warranty_months, obsolescence_years, domain, status, tenant_id)
            VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?)
        `, [
            device_code, serial_number || null, equipment_type, brand, model,
            ram_memory || null, disk_capacity || null, processor || null, operating_system || null,
            acquisition_type || 'Propio', warranty_months || null, obsolescence_years || null,
            domain || null, status || 'Disponible', tenantId(req),
        ]);

        ok(res, { id: result.insertId, device_code }, { message: 'Equipo creado exitosamente' });
    } catch (e) {
        console.error('❌ [almacen/equipment POST]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// FALLAS — GET /api/almacen/fallas
// Query params: status, search, page, limit
// ============================================================================
router.get('/fallas', async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page  || 1));
        const limit  = Math.min(100, parseInt(req.query.limit || 25));
        const offset = (page - 1) * limit;
        const status = req.query.status || null;
        const search = req.query.search || null;

        let where  = ['f.tenant_id = ?'];
        let params = [tenantId(req)];

        if (status) { where.push('f.repair_status = ?'); params.push(status); }
        if (search) {
            where.push('(e.device_code LIKE ? OR e.brand LIKE ? OR e.model LIKE ? OR f.description LIKE ?)');
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        const whereStr = 'WHERE ' + where.join(' AND ');

        const [rows, total] = await Promise.all([
            executeQuery(equipmentPool, `
                SELECT /* tenant_id: filtrado en whereStr */
                    f.id, f.description, f.component, f.supplier,
                    f.estimated_cost, f.repair_status, f.registered_by,
                    f.created_at, f.updated_at,
                    e.id AS equipment_id, e.device_code, e.brand,
                    e.model, e.equipment_type, e.serial_number
                FROM equipment_faults f
                JOIN equipment e ON f.equipment_id = e.id
                ${whereStr}
                ORDER BY
                    FIELD(f.repair_status,'Pendiente','En proceso','Esperando repuesto','Resuelto','Dado de baja'),
                    f.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]),

            executeQuery(equipmentPool, `
                SELECT COUNT(*) AS total /* tenant_id: filtrado en whereStr */
                FROM equipment_faults f
                JOIN equipment e ON f.equipment_id = e.id
                ${whereStr}
            `, params),
        ]);

        ok(res, rows, { pagination: { total: total[0].total, page, limit, pages: Math.ceil(total[0].total / limit) } });
    } catch (e) {
        console.error('❌ [almacen/fallas GET]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// REGISTRAR FALLA — POST /api/almacen/fallas
// ============================================================================
router.post('/fallas', async (req, res) => {
    try {
        const {
            equipment_id, description, component,
            supplier, estimated_cost, repair_status, registered_by,
        } = req.body;

        if (!equipment_id || !description || !component) {
            return err(res, 'Campos requeridos: equipment_id, description, component', 400);
        }

        // Marcar equipo como En Reparación (solo si es del tenant)
        const upd = await executeQuery(equipmentPool,
            "UPDATE equipment SET status = 'En Reparación' WHERE id = ? AND tenant_id = ?", [equipment_id, tenantId(req)]);
        if (!upd.affectedRows) return err(res, 'Equipo no encontrado', 404);

        const result = await executeQuery(equipmentPool, `
            INSERT INTO equipment_faults
                (equipment_id, description, component, supplier,
                 estimated_cost, repair_status, registered_by, tenant_id)
            VALUES (?,?,?,?, ?,?,?, ?)
        `, [
            equipment_id, description, component, supplier || null,
            estimated_cost || null, repair_status || 'Pendiente',
            registered_by || (req.user?.username || null), tenantId(req),
        ]);

        ok(res, { id: result.insertId }, { message: 'Falla registrada. Equipo marcado como En Reparación.' });
    } catch (e) {
        console.error('❌ [almacen/fallas POST]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// ACTUALIZAR FALLA — PUT /api/almacen/fallas/:id
// ============================================================================
router.put('/fallas/:id', async (req, res) => {
    try {
        const { description, component, supplier, estimated_cost, repair_status } = req.body;
        const faultId = req.params.id;

        const result = await executeQuery(equipmentPool, `
            UPDATE equipment_faults
            SET description    = COALESCE(?, description),
                component      = COALESCE(?, component),
                supplier       = COALESCE(?, supplier),
                estimated_cost = COALESCE(?, estimated_cost),
                repair_status  = COALESCE(?, repair_status)
            WHERE id = ? AND tenant_id = ?
        `, [description, component, supplier, estimated_cost, repair_status, faultId, tenantId(req)]);

        if (!result.affectedRows) return err(res, 'Falla no encontrada', 404);

        // Si se marca como Resuelto → equipo vuelve a Disponible
        if (repair_status === 'Resuelto') {
            const fault = await executeQuery(equipmentPool,
                'SELECT equipment_id FROM equipment_faults WHERE id = ? AND tenant_id = ?', [faultId, tenantId(req)]);
            if (fault.length) {
                await executeQuery(equipmentPool,
                    "UPDATE equipment SET status = 'Disponible' WHERE id = ? AND tenant_id = ?",
                    [fault[0].equipment_id, tenantId(req)]);
            }
        }
        // Si se marca como Dado de baja
        if (repair_status === 'Dado de baja') {
            const fault = await executeQuery(equipmentPool,
                'SELECT equipment_id FROM equipment_faults WHERE id = ? AND tenant_id = ?', [faultId, tenantId(req)]);
            if (fault.length) {
                await executeQuery(equipmentPool,
                    "UPDATE equipment SET status = 'Dado de Baja' WHERE id = ? AND tenant_id = ?",
                    [fault[0].equipment_id, tenantId(req)]);
            }
        }

        ok(res, null, { message: 'Falla actualizada' });
    } catch (e) {
        console.error('❌ [almacen/fallas PUT]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// TRASLADOS — GET /api/almacen/traslados
// Query params: search, page, limit
// ============================================================================
router.get('/traslados', async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page  || 1));
        const limit  = Math.min(100, parseInt(req.query.limit || 25));
        const offset = (page - 1) * limit;
        const search = req.query.search || null;

        let where  = ['t.tenant_id = ?'];
        let params = [tenantId(req)];

        if (search) {
            where.push(`(e.device_code LIKE ? OR e.brand LIKE ? OR e.model LIKE ?
                         OR lo.location_name LIKE ? OR ld.location_name LIKE ?)`);
            const s = `%${search}%`;
            params.push(s, s, s, s, s);
        }

        const whereStr = 'WHERE ' + where.join(' AND ');

        const [rows, total] = await Promise.all([
            executeQuery(equipmentPool, `
                SELECT /* tenant_id: filtrado en whereStr */
                    t.id, t.transfer_date, t.notes, t.created_at,
                    e.device_code, e.brand, e.model, e.equipment_type,
                    lo.location_name AS origin_name,    lo.city AS origin_city,
                    ld.location_name AS destination_name, ld.city AS destination_city
                FROM equipment_transfers t
                JOIN  equipment  e  ON t.equipment_id             = e.id
                LEFT  JOIN locations lo ON t.origin_location_id   = lo.id
                JOIN  locations ld ON t.destination_location_id   = ld.id
                ${whereStr}
                ORDER BY t.transfer_date DESC, t.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]),

            executeQuery(equipmentPool, `
                SELECT COUNT(*) AS total /* tenant_id: filtrado en whereStr */
                FROM equipment_transfers t
                JOIN  equipment  e  ON t.equipment_id             = e.id
                LEFT  JOIN locations lo ON t.origin_location_id   = lo.id
                JOIN  locations ld ON t.destination_location_id   = ld.id
                ${whereStr}
            `, params),
        ]);

        ok(res, rows, { pagination: { total: total[0].total, page, limit, pages: Math.ceil(total[0].total / limit) } });
    } catch (e) {
        console.error('❌ [almacen/traslados GET]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// REGISTRAR TRASLADO — POST /api/almacen/traslados
// ============================================================================
router.post('/traslados', async (req, res) => {
    try {
        const { equipment_id, destination_location_id, transfer_date, notes } = req.body;

        if (!equipment_id || !destination_location_id || !transfer_date) {
            return err(res, 'Campos requeridos: equipment_id, destination_location_id, transfer_date', 400);
        }

        // Verificar que el equipo existe
        const eq = await executeQuery(equipmentPool,
            'SELECT id, device_code FROM equipment WHERE id = ? AND tenant_id = ? LIMIT 1', [equipment_id, tenantId(req)]);
        if (!eq.length) return err(res, 'Equipo no encontrado', 404);

        // Obtener ubicación origen del último traslado registrado (si existe)
        const lastTransfer = await executeQuery(equipmentPool,
            'SELECT destination_location_id FROM equipment_transfers WHERE equipment_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1',
            [equipment_id, tenantId(req)]);
        const origin_location_id = lastTransfer.length ? lastTransfer[0].destination_location_id : null;

        const [dest] = await executeQuery(equipmentPool, 'SELECT id FROM locations WHERE id = ? AND tenant_id = ?', [destination_location_id, tenantId(req)]);
        if (!dest) return err(res, 'Ubicación destino no encontrada', 404);

        // No trasladar al mismo lugar
        if (origin_location_id && String(origin_location_id) === String(destination_location_id)) {
            return err(res, 'El origen y destino no pueden ser el mismo', 400);
        }

        const result = await executeQuery(equipmentPool, `
            INSERT INTO equipment_transfers
                (equipment_id, origin_location_id, destination_location_id, transfer_date, notes, tenant_id)
            VALUES (?,?,?,?,?,?)
        `, [equipment_id, origin_location_id, destination_location_id, transfer_date, notes || null, tenantId(req)]);

        ok(res, { id: result.insertId }, { message: `Traslado registrado para equipo ${eq[0].device_code}` });
    } catch (e) {
        console.error('❌ [almacen/traslados POST]', e.message);
        err(res, e.message);
    }
});

// ============================================================================
// UBICACIONES — GET /api/almacen/locations
// Para los selects de traslado
// ============================================================================
router.get('/locations', async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool, `
            SELECT id, location_name, city, address
            FROM locations
            WHERE is_active = 1 AND tenant_id = ?
            ORDER BY city, location_name
        `, [tenantId(req)]);
        ok(res, rows);
    } catch (e) {
        err(res, e.message);
    }
});

// ============================================================================
// EQUIPOS PARA SELECT (búsqueda rápida en traslados/fallas)
// GET /api/almacen/equipment-search?q=XXX&status=Disponible
// ============================================================================
router.get('/equipment-search', async (req, res) => {
    try {
        const q      = req.query.q      || '';
        const status = req.query.status || null;

        let where  = ['tenant_id = ?'];
        let params = [tenantId(req)];

        if (q.length >= 2) {
            where.push('(device_code LIKE ? OR brand LIKE ? OR model LIKE ?)');
            const s = `%${q}%`;
            params.push(s, s, s);
        }
        if (status) { where.push('status = ?'); params.push(status); }

        const sql = `
            SELECT id, device_code, brand, model, equipment_type, status /* tenant_id: filtrado en where */
            FROM equipment
            WHERE ${where.join(' AND ')}
            ORDER BY device_code
            LIMIT 20
        `;
        const rows = await executeQuery(equipmentPool, sql, params);
        ok(res, rows);
    } catch (e) {
        console.error('❌ [equipment-search]', e.message);
        err(res, e.message);
    }
});

module.exports = router;

// ============================================================================
// routes/equipment.js — LIMPIO
// CAMBIO CRÍTICO: eliminada ruta duplicada router.get('/api/equipment', ...)
// que usaba PostgreSQL ($1, $2) e interceptaba/rompía los filtros
// ============================================================================

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { equipmentPool, executeQuery } = require('../../config/database');
const checkPermission = require('../../middleware/checkPermission');
const { authenticateToken } = require('../../middleware/auth');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ============================================================================
// SECCIÓN 1: RUTAS GET ESPECÍFICAS (sin parámetros dinámicos)
// ============================================================================

router.get('/desktop', async (req, res, next) => {
  try {
    const query = 'SELECT COUNT(*) AS total_equipos FROM equipment WHERE equipment_type = "Desktop"';
    const results = await executeQuery(equipmentPool, query);
    res.json(results[0].total_equipos);
  } catch (error) { next(error); }
});

router.get('/laptop', async (req, res, next) => {
  try {
    const query = 'SELECT COUNT(*) AS total_equipos FROM equipment WHERE equipment_type = "laptop"';
    const results = await executeQuery(equipmentPool, query);
    res.json(results[0].total_equipos);
  } catch (error) { next(error); }
});

router.get('/ultra', async (req, res, next) => {
  try {
    const query = "SELECT COUNT(*) AS total_ultra FROM equipment WHERE processor LIKE '%ultra%'";
    const results = await executeQuery(equipmentPool, query);
    res.json(results[0].total_ultra);
  } catch (error) { next(error); }
});

router.get('/available', async (req, res, next) => {
  try {
    const results = await executeQuery(equipmentPool, 'SELECT * FROM equipment_availability');
    res.json({ success: true, data: results, count: results.length });
  } catch (error) { next(error); }
});

router.get('/search', async (req, res, next) => {
  try {
    const { term } = req.query;
    if (!term) return res.status(400).json({ success: false, error: 'Parámetro de búsqueda requerido' });

// DESPUÉS — solo equipos Disponibles
const queryStr = `
  SELECT id, device_code, serial_number, equipment_type, brand, model,
         processor, operating_system, disk_capacity, ram_memory, status
  FROM equipment
  WHERE status = 'Disponible'
    AND (device_code LIKE ? OR serial_number LIKE ? OR model LIKE ? OR brand LIKE ?)
  ORDER BY device_code LIMIT 20
`;
const searchTerm = `%${term}%`;
const results = await executeQuery(equipmentPool, queryStr, [searchTerm, searchTerm, searchTerm, searchTerm]);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) { next(error); }
});

router.get('/status-options', async (req, res) => {
  try {
    const query = `
      SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'equipment_management'
        AND TABLE_NAME = 'equipment' AND COLUMN_NAME = 'status'
    `;
    const result = await executeQuery(equipmentPool, query);
    if (result.length > 0 && result[0].COLUMN_TYPE?.startsWith('enum')) {
      const match = result[0].COLUMN_TYPE.match(/enum\((.*)\)/i);
      if (match) {
        const values = match[1].split(',').map(v => v.replace(/'/g, '').trim());
        return res.json({ success: true, options: values });
      }
    }
    res.json({ success: true, options: ['Asignado', 'Disponible', 'Mantenimiento', 'Obsoleto'] });
  } catch (error) {
    res.json({ success: true, options: ['Asignado', 'Disponible', 'Mantenimiento', 'Obsoleto'] });
  }
});

// ============================================================================
// SECCIÓN 2: RUTAS CON PARÁMETROS ESPECÍFICOS
// ============================================================================

router.get('/status/:status', async (req, res, next) => {
  try {
    const results = await callStoredProcedure(equipmentPool, 'sp_get_equipment_by_status', [req.params.status]);
    res.json({ success: true, data: results[0], count: results[0].length });
  } catch (error) { next(error); }
});

// ============================================================================
// SECCIÓN 3: PUT /update
// ============================================================================

router.put('/update', async (req, res) => {
  const {
    device_code, serial_number = null, equipment_type = null,
    brand = null, model = null, ram_memory = null, disk_capacity = null,
    status = null, is_stolen = null,
  } = req.body;

  try {
    if (!device_code) return res.status(400).json({ success: false, message: 'El código de dispositivo es requerido' });

    const stolenVal = is_stolen !== null ? (is_stolen ? 1 : 0) : null;
    const stolenClause = stolenVal !== null ? ', is_stolen = ?' : '';
    const stolenParam  = stolenVal !== null ? [stolenVal] : [];

    const query = `
      UPDATE equipment SET
        serial_number = ?, equipment_type = ?, brand = ?, model = ?,
        ram_memory = ?, disk_capacity = ?, status = ?${stolenClause}
      WHERE device_code = ?
    `;
    const result = await executeQuery(equipmentPool, query,
      [serial_number, equipment_type, brand, model, ram_memory, disk_capacity, status, ...stolenParam, device_code]
    );

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Equipo actualizado correctamente.', changedRows: result.changedRows });
    } else {
      res.status(404).json({ success: false, message: 'No se encontró el equipo.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// SECCIÓN 4: POST / — crear equipo
// ============================================================================

router.post('/',
  authenticateToken,
  checkPermission('equipment', 'create'),
  [
    body('device_code').notEmpty().withMessage('Código de dispositivo requerido'),
    body('serial_number').notEmpty().withMessage('Número de serie requerido'),
    body('equipment_type').isIn(['Laptop', 'Desktop', 'Tablet', 'Smartphone', 'Monitor', 'Otro']).withMessage('Tipo inválido'),
    body('brand').notEmpty().withMessage('Marca requerida'),
    body('model').notEmpty().withMessage('Modelo requerido'),
    validate
  ],
  async (req, res) => {
    let { device_code, serial_number, equipment_type, brand, model,
          processor, operating_system, disk_capacity, ram_memory,
          acquisition_type, obsolescence_years, domain, it_level_1, it_level_2, status } = req.body;

    try {
      // Verificar duplicado device_code
      const checkCode = await executeQuery(equipmentPool,
        'SELECT id FROM equipment WHERE device_code = ? LIMIT 1', [device_code]);
      if (checkCode.length > 0) {
        return res.status(409).json({ success: false, error: `El código "${device_code}" ya existe`, field: 'device_code' });
      }

      // Verificar duplicado serial_number
      const checkSerial = await executeQuery(equipmentPool,
        'SELECT id FROM equipment WHERE serial_number = ? LIMIT 1', [serial_number]);
      if (checkSerial.length > 0) {
        return res.status(409).json({ success: false, error: `El serial "${serial_number}" ya existe`, field: 'serial_number' });
      }

      const result = await executeQuery(equipmentPool, `
        INSERT INTO equipment (
          device_code, serial_number, equipment_type, brand, model,
          processor, operating_system, disk_capacity, ram_memory,
          acquisition_type, obsolescence_years, domain, it_level_1, it_level_2, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        device_code, serial_number, equipment_type, brand, model,
        processor || null, operating_system || null, disk_capacity || null, ram_memory || null,
        acquisition_type || 'Propio', obsolescence_years || null, domain || null,
        it_level_1 || null, it_level_2 || null, status || 'Disponible'
      ]);

      return res.status(201).json({
        success: true, message: 'Equipo creado exitosamente',
        data: { id: result.insertId, device_code, serial_number, brand, model, equipment_type, status: status || 'Disponible' }
      });

    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, error: 'Duplicado detectado', code: 'DUPLICATE_ENTRY' });
      }
      return res.status(500).json({ success: false, error: 'Error al crear el equipo', message: error.message });
    }
  }
);

// ============================================================================
// SECCIÓN 5: GET / — LISTADO CON FILTROS (MYSQL) ← LA RUTA PRINCIPAL
// ⭐ Esta es la única ruta que maneja filtros. La ruta duplicada de PostgreSQL
//    fue eliminada porque usaba $1/$2 y pool.query() (PostgreSQL) en vez de
//    executeQuery(equipmentPool, ...) (MySQL) y rompía el filtrado.
// ============================================================================

router.get('/', authenticateToken, checkPermission('equipment', 'read'), async (req, res, next) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const searchTerm       = (req.query.search            || '').trim();
    const brand            = (req.query.brand             || '').trim() || null;
    const operating_system = (req.query.operating_system  || '').trim() || null;
    const equipment_type   = (req.query.equipment_type    || '').trim() || null;
    const estado_operativo = (req.query.estado_operativo  || '').trim() || null;
    const status_filter    = (req.query.status            || '').trim() || null;

    const tenantId = parseInt(req.user?.tenant_id || 1);

    let whereConditions = ['e.tenant_id = ?'];
    let queryParams     = [tenantId];

    if (equipment_type) {
      whereConditions.push('e.equipment_type = ?');
      queryParams.push(equipment_type);
    }

    if (estado_operativo) {
      switch (estado_operativo) {
        case 'Robado':
          whereConditions.push('e.is_stolen = 1');
          break;
        case 'Dañado':
          whereConditions.push(`EXISTS (SELECT 1 FROM equipment_faults f WHERE f.equipment_id = e.id AND f.repair_status NOT IN ('Resuelto','Dado de baja'))`);
          break;
        case 'Por recuperar':
          whereConditions.push(`EXISTS (SELECT 1 FROM equipment_recoveries r WHERE r.equipment_id = e.id AND r.status != 'recuperado')`);
          break;
        case 'Prestado':
          whereConditions.push(`EXISTS (SELECT 1 FROM equipment_loans l WHERE l.equipment_id = e.id AND l.estado = 'activo')`);
          break;
        case 'En Tránsito':
          whereConditions.push('e.status = ?');
          queryParams.push('En Tránsito');
          break;
        case 'Asignado':
          whereConditions.push('e.status = ? AND e.is_stolen = 0');
          queryParams.push('Asignado');
          break;
        case 'Disponible':
          whereConditions.push('e.status = ? AND e.is_stolen = 0');
          queryParams.push('Disponible');
          break;
      }
    }

    if (status_filter) {
      whereConditions.push('e.status = ?');
      queryParams.push(status_filter);
    }

    if (brand) {
      if (brand === 'Sin marca') {
        whereConditions.push('(e.brand IS NULL OR e.brand = "" OR e.brand = "Sin marca")');
      } else {
        whereConditions.push('e.brand = ?');
        queryParams.push(brand);
      }
      console.log('🔵 Filtro MARCA:', brand);
    }

    if (operating_system) {
      whereConditions.push('COALESCE(e.operating_system, s1.sistema_operativo, s2.sistema_operativo) = ?');
      queryParams.push(operating_system);
      console.log('🔵 Filtro SO:', operating_system);
    }

    if (searchTerm) {
      const p = `%${searchTerm}%`;
      whereConditions.push(`(
        e.device_code LIKE ? OR e.serial_number LIKE ? OR e.equipment_type LIKE ?
        OR e.brand LIKE ? OR e.model LIKE ? OR e.status LIKE ? OR e.processor LIKE ? OR e.ram_memory LIKE ?
      )`);
      for (let i = 0; i < 8; i++) queryParams.push(p);
      console.log('🔍 Búsqueda global:', searchTerm);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    // JOINs SCCM separados y JOIN asignación activa
    const J1   = `LEFT JOIN sccm_inventory s1 ON s1.hostname    = e.device_code`;
    const J2   = `LEFT JOIN sccm_inventory s2 ON s2.bios_serial = e.serial_number AND s1.hostname IS NULL`;
    const JASG = `LEFT JOIN (
                    SELECT a.equipment_id, emp.full_name AS assigned_to, emp.cip AS assigned_cip, emp.email AS assigned_email
                    FROM assignments a
                    JOIN employees emp ON emp.id = a.employee_id
                    WHERE a.status = 'Activo' AND a.tenant_id = ${tenantId}
                  ) asgn ON asgn.equipment_id = e.id`;

    // Total sin filtros (para DataTables recordsTotal) — restringido al tenant
    const totalAllRes = await executeQuery(equipmentPool, 'SELECT COUNT(*) AS total FROM equipment WHERE tenant_id = ?', [tenantId]);
    const totalAll = totalAllRes[0].total;

    // Total con filtros
    const countResults = await executeQuery(equipmentPool,
      `SELECT COUNT(*) as total FROM equipment e ${J1} ${J2} ${whereClause}`, queryParams);
    const total = countResults[0].total;

    // Datos paginados con empleado asignado
    const dataResults = await executeQuery(equipmentPool,
      `SELECT e.*,
        COALESCE(e.operating_system, s1.sistema_operativo, s2.sistema_operativo) AS operating_system,
        COALESCE(e.domain, s1.dominio, s2.dominio) AS domain,
        (SELECT id FROM equipment_loans WHERE equipment_id = e.id AND estado = 'activo' LIMIT 1) AS active_loan_id,
        asgn.assigned_to, asgn.assigned_cip, asgn.assigned_email
       FROM equipment e ${J1} ${J2} ${JASG} ${whereClause} ORDER BY e.device_code ASC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    res.json({
      success:          true,
      data:             dataResults,
      recordsTotal:     totalAll,   // requerido por DataTables serverSide
      recordsFiltered:  total,      // requerido por DataTables serverSide
      pagination: {
        currentPage:  page,
        totalPages:   Math.ceil(total / limit),
        totalItems:   total,
        itemsPerPage: limit
      },
    });

  } catch (error) {
    console.error('❌ Error GET /api/equipment:', error);
    next(error);
  }
});

// ============================================================================
// SECCIÓN 6: GET /pivot — tabla pivote tipo × modelo × año
// ============================================================================
router.get('/pivot', authenticateToken, async (req, res) => {
  try {
    const tId = parseInt(req.user?.tenant_id || 1);
    const rows = await executeQuery(equipmentPool, `
      SELECT equipment_type, model, obsolescence_years AS year, COUNT(*) AS cnt
      FROM equipment
      WHERE tenant_id = ?
      GROUP BY equipment_type, model, obsolescence_years
      ORDER BY equipment_type, model, obsolescence_years
    `, [tId]);

    const years = [...new Set(rows.map(r => r.year).filter(y => y))].sort((a, b) => a - b);

    const tree = {};
    for (const r of rows) {
      if (!tree[r.equipment_type]) tree[r.equipment_type] = {};
      if (!tree[r.equipment_type][r.model]) tree[r.equipment_type][r.model] = {};
      tree[r.equipment_type][r.model][r.year] = r.cnt;
    }

    const sinEqRows = await executeQuery(equipmentPool, `
      SELECT COUNT(*) AS sinEquipo FROM employees e
      WHERE e.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM assignments a
          WHERE a.employee_id = e.id AND a.status = 'Activo' AND a.tenant_id = ?
        )
    `, [tId, tId]);
    const sinEquipo = sinEqRows[0]?.sinEquipo || 0;

    res.json({ success: true, data: { tree, years, sinEquipo } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SECCIÓN 7: GET /kpis — conteos rápidos para los cards
// ============================================================================
router.get('/kpis', authenticateToken, async (req, res) => {
  try {
    const tId = parseInt(req.user?.tenant_id || 1);
    const byType = await executeQuery(equipmentPool,
      'SELECT equipment_type, COUNT(*) AS cnt FROM equipment WHERE tenant_id = ? GROUP BY equipment_type', [tId]);

    const totRow = await executeQuery(equipmentPool,
      'SELECT COUNT(*) AS total FROM equipment WHERE tenant_id = ?', [tId]);
    const total = totRow[0]?.total || 0;

    const sinEqRows = await executeQuery(equipmentPool, `
      SELECT COUNT(*) AS sinEquipo FROM employees e
      WHERE e.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM assignments a WHERE a.employee_id = e.id AND a.status = 'Activo' AND a.tenant_id = ?
        )
    `, [tId, tId]);
    const sinEquipo = sinEqRows[0]?.sinEquipo || 0;

    const map = {};
    byType.forEach(r => { map[r.equipment_type] = r.cnt; });

    res.json({
      success: true,
      data: {
        total,
        laptop:      map['Laptop']      || 0,
        desktop:     map['Desktop']     || 0,
        ultraligera: map['Ultraligera'] || 0,
        otro:        map['Otro']        || 0,
        sinEquipo:   sinEquipo          || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SECCIÓN 8: GET /charts — agregaciones para gráficos
// ============================================================================

// Cache en memoria por tenant: { [tenantId]: { data, at } }
const _chartsCache = {};
const CHARTS_TTL   = 5 * 60 * 1000;

router.get('/charts', authenticateToken, async (req, res) => {
  const tId = parseInt(req.user?.tenant_id || 1);
  const cached = _chartsCache[tId];
  if (cached && (Date.now() - cached.at) < CHARTS_TTL) {
    return res.json({ success: true, data: cached.data });
  }
  try {
    const [brands, soRows] = await Promise.all([
      executeQuery(equipmentPool, `
        SELECT COALESCE(NULLIF(brand,''), 'Sin marca') AS label, COUNT(*) AS cnt
        FROM equipment
        WHERE tenant_id = ?
        GROUP BY label ORDER BY cnt DESC LIMIT 10
      `, [tId]),
      executeQuery(equipmentPool, `
        SELECT COALESCE(
                 e.operating_system,
                 s1.sistema_operativo,
                 s2.sistema_operativo,
                 CASE
                   WHEN e.obsolescence_years >= 2022 THEN 'Windows 11'
                   WHEN e.obsolescence_years BETWEEN 2015 AND 2021 THEN 'Windows 10'
                   WHEN e.obsolescence_years BETWEEN 2009 AND 2014 THEN 'Windows 7'
                   ELSE 'Sin SO'
                 END
               ) AS label,
               COUNT(*) AS cnt
        FROM equipment e
        LEFT JOIN sccm_inventory s1 ON s1.hostname    = e.device_code
        LEFT JOIN sccm_inventory s2 ON s2.bios_serial = e.serial_number AND s1.hostname IS NULL
        WHERE e.tenant_id = ?
        GROUP BY label ORDER BY cnt DESC LIMIT 20
      `, [tId]),
    ]);

    _chartsCache[tId] = {
      data: {
        brands: brands.map(r => ({ label: r.label, cnt: Number(r.cnt) })),
        so:     soRows.map(r => ({ label: r.label, cnt: Number(r.cnt) })),
      },
      at: Date.now(),
    };

    res.json({ success: true, data: _chartsCache[tId].data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SECCIÓN 8.5: DETALLES + PRÉSTAMOS (antes de /:id catch-all)
// ============================================================================

router.get('/:id/details', authenticateToken, async (req, res, next) => {
  try {
    const device_code = req.params.id;
    const rows = await executeQuery(equipmentPool, `
      SELECT e.*,
        COALESCE(e.operating_system, s1.sistema_operativo, s2.sistema_operativo) AS operating_system,
        COALESCE(e.domain,            s1.dominio,           s2.dominio)           AS domain,
        COALESCE(e.processor,         s1.cpu_1,             s2.cpu_1)             AS processor,
        COALESCE(e.ram_memory,        s1.memoria_ram,       s2.memoria_ram)       AS ram_memory,
        COALESCE(e.disk_capacity,     s1.disco_1_capacidad, s2.disco_1_capacidad) AS disk_capacity
      FROM equipment e
      LEFT JOIN sccm_inventory s1 ON s1.hostname    = e.device_code
      LEFT JOIN sccm_inventory s2 ON s2.bios_serial = e.serial_number AND s1.hostname IS NULL
      WHERE e.device_code = ? AND e.tenant_id = ? LIMIT 1
    `, [device_code, parseInt(req.user?.tenant_id || 1)]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });
    const eq = rows[0];

    const [assigned, falla, recovery, loan, last_transfer] = await Promise.all([
      executeQuery(equipmentPool, `
        SELECT e.full_name AS nombre, d.department_name AS department, e.email
        FROM assignments a
        JOIN employees e ON a.employee_id = e.id
        LEFT JOIN departments d ON a.department_id = d.id
        WHERE a.equipment_id = ? AND a.status = 'Activo' LIMIT 1
      `, [eq.id]),
      executeQuery(equipmentPool, `
        SELECT description, component, repair_status, estimated_cost, created_at
        FROM equipment_faults
        WHERE equipment_id = ? AND repair_status NOT IN ('Resuelto','Dado de baja')
        ORDER BY created_at DESC LIMIT 1
      `, [eq.id]),
      executeQuery(equipmentPool, `
        SELECT status, recovery_method, technician_name, scheduled_date, notes
        FROM equipment_recoveries
        WHERE equipment_id = ? AND status != 'recuperado'
        ORDER BY created_at DESC LIMIT 1
      `, [eq.id]),
      executeQuery(equipmentPool, `
        SELECT id, prestado_a, prestado_desde, prestado_hasta, notes
        FROM equipment_loans
        WHERE equipment_id = ? AND estado = 'activo'
        ORDER BY created_at DESC LIMIT 1
      `, [eq.id]),
      executeQuery(equipmentPool, `
        SELECT t.transfer_date, t.notes,
               lo.location_name AS origin_name, lo.city AS origin_city,
               ld.location_name AS destination_name, ld.city AS destination_city
        FROM equipment_transfers t
        LEFT JOIN locations lo ON t.origin_location_id = lo.id
        JOIN  locations ld ON t.destination_location_id = ld.id
        WHERE t.equipment_id = ? ORDER BY t.created_at DESC LIMIT 1
      `, [eq.id]),
    ]);

    let estado_operativo = eq.status || 'Desconocido';
    if (eq.is_stolen == 1)   estado_operativo = 'Robado';
    else if (recovery.length) estado_operativo = 'Por recuperar';
    else if (falla.length)    estado_operativo = 'Dañado';
    else if (loan.length)     estado_operativo = 'Prestado';
    else if (eq.status === 'En Tránsito') estado_operativo = 'En tránsito';

    res.json({ success: true, data: {
      ...eq,
      assigned_to:    assigned[0]      || null,
      estado_operativo,
      falla:          falla[0]         || null,
      recovery:       recovery[0]      || null,
      loan:           loan[0]          || null,
      last_transfer:  last_transfer[0] || null,
    }});
  } catch (e) { console.error('❌ GET /:id/details:', e.message); next(e); }
});

router.post('/loans', authenticateToken, async (req, res, next) => {
  try {
    const { device_code, prestado_a, prestado_desde, prestado_hasta, notes } = req.body;
    if (!device_code || !prestado_a || !prestado_hasta)
      return res.status(400).json({ success: false, error: 'Campos requeridos: device_code, prestado_a, prestado_hasta' });

    const eqRows = await executeQuery(equipmentPool,
      'SELECT id FROM equipment WHERE device_code = ? LIMIT 1', [device_code]);
    if (!eqRows.length) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });

    const existing = await executeQuery(equipmentPool,
      "SELECT id FROM equipment_loans WHERE equipment_id = ? AND estado = 'activo' LIMIT 1", [eqRows[0].id]);
    if (existing.length) return res.status(409).json({ success: false, error: 'El equipo ya tiene un préstamo activo' });

    const desde = prestado_desde || new Date().toISOString().slice(0, 10);
    const result = await executeQuery(equipmentPool, `
      INSERT INTO equipment_loans (equipment_id, prestado_a, prestado_desde, prestado_hasta, notes, created_by)
      VALUES (?,?,?,?,?,?)
    `, [eqRows[0].id, prestado_a, desde, prestado_hasta, notes || null, req.user?.username || null]);

    res.json({ success: true, data: { id: result.insertId }, message: 'Préstamo registrado correctamente' });
  } catch (e) { console.error('❌ POST /loans:', e.message); next(e); }
});

router.put('/loans/:id/return', authenticateToken, async (req, res, next) => {
  try {
    const result = await executeQuery(equipmentPool, `
      UPDATE equipment_loans SET estado = 'devuelto', devuelto_at = NOW(), updated_at = NOW()
      WHERE id = ? AND estado = 'activo'
    `, [req.params.id]);
    if (!result.affectedRows)
      return res.status(404).json({ success: false, error: 'Préstamo no encontrado o ya devuelto' });
    res.json({ success: true, message: 'Equipo devuelto — estado actualizado a Disponible' });
  } catch (e) { console.error('❌ PUT /loans/:id/return:', e.message); next(e); }
});

// ============================================================================
// SECCIÓN 9: GET /:id — DEBE IR AL FINAL
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const results = await executeQuery(equipmentPool,
      'SELECT * FROM equipment WHERE device_code = ?', [req.params.id]);
    if (!results.length) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });
    res.json({ success: true, data: results[0] });
  } catch (error) { next(error); }
});

module.exports = router;  

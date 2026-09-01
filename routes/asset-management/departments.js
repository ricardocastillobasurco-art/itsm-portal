// ============================================================================
// routes/departments.js - RUTAS PARA DEPARTAMENTOS
// ============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { equipmentPool, callStoredProcedure, executeQuery } = require('../../config/database');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

// GET /api/departments - Listar departamentos
router.get('/', async (req, res, next) => {
  try {
    const queryStr = 'SELECT * FROM departments WHERE is_active = TRUE ORDER BY department_name';
    const results = await executeQuery(equipmentPool, queryStr);
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/departments/search - Buscar departamentos (DEBE IR ANTES DE /:id)
router.get('/search', async (req, res, next) => {
  try {
    const { term } = req.query;
    
    console.log('🔍 Buscando departamento:', term);
    
    if (!term) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro de búsqueda requerido'
      });
    }

    const queryStr = `
      SELECT * FROM departments
      WHERE is_active = TRUE
        AND (
          department_name COLLATE utf8mb4_unicode_ci LIKE ?
          OR division COLLATE utf8mb4_unicode_ci LIKE ?
          OR desc_ceo_4 COLLATE utf8mb4_unicode_ci LIKE ?
        )
      ORDER BY department_name
      LIMIT 20
    `;

    const searchTerm = `%${term}%`;
    const results = await executeQuery(equipmentPool, queryStr, [searchTerm, searchTerm, searchTerm]);

    console.log('✅ Departamentos encontrados:', results.length);

    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error) {
    console.error('❌ Error en búsqueda de departamentos:', error);
    next(error);
  }
});

// ⭐ NUEVO: PUT /api/departments/update - Actualizar departamento
// ============================================================================
// PUT /api/departments/update - VERSIÓN FINAL CON DIAGNÓSTICO
// ============================================================================

router.put('/update', async (req, res) => {
    console.log('\n═══════════════════════════════════════════════');
    console.log('📥 PUT /api/departments/update');
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('═══════════════════════════════════════════════');
    
    // 🔍 Log completo del request
    console.log('📋 req.body completo:');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('');
    console.log('📋 Content-Type:', req.headers['content-type']);
    console.log('');
    
    // Extraer datos
    const {
        id,
        department_name,
        division,
        subactivity,
        desc_ceo,
        desc_ceo_1,
        desc_ceo_2,
        desc_ceo_3,
        desc_ceo_4,
        desc_ceo_5,
        desc_ceo_6,
        desc_ceo_7
    } = req.body;
    
    console.log('📊 Valores extraídos:');
    console.log(`  - id: "${id}" (tipo: ${typeof id})`);
    console.log(`  - department_name: "${department_name}"`);
    console.log(`  - division: "${division}"`);
    console.log(`  - subactivity: "${subactivity}"`);
    console.log(`  - desc_ceo_4: "${desc_ceo_4}"`);
    
    try {
        // ✅ Validación 1: ID requerido
        if (!id) {
            console.error('❌ VALIDACIÓN FALLIDA: ID no proporcionado');
            return res.status(400).json({ 
                success: false, 
                message: 'El ID del departamento es requerido' 
            });
        }
        console.log('✅ Validación ID: OK');
        
        // ✅ Validación 2: Nombre requerido
        if (!department_name || department_name.trim() === '') {
            console.error('❌ VALIDACIÓN FALLIDA: Nombre vacío');
            return res.status(400).json({ 
                success: false, 
                message: 'El nombre del departamento es requerido' 
            });
        }
        console.log('✅ Validación nombre: OK');
        
        // 🔍 Verificar que el departamento existe
        console.log('');
        console.log('🔍 Verificando existencia del departamento...');
        const checkQuery = 'SELECT * FROM departments WHERE id = ?';
        console.log('  Query:', checkQuery);
        console.log('  Parámetros:', [id]);
        
        const before = await executeQuery(equipmentPool, checkQuery, [id]);
        console.log('  Resultados:', before.length, 'registro(s)');
        
        if (before.length === 0) {
            console.error(`❌ ERROR: Departamento con ID ${id} no encontrado`);
            return res.status(404).json({ 
                success: false, 
                message: `No se encontró el departamento con ID: ${id}` 
            });
        }
        
        console.log('✅ Departamento encontrado');
        console.log('📊 Estado ANTES de actualizar:');
        console.log(JSON.stringify(before[0], null, 2));
        
        // 🔄 Preparar actualización
        console.log('');
        console.log('🔄 Preparando UPDATE...');
        
        const updateQuery = `
            UPDATE departments
            SET 
                department_name = ?,
                division = ?,
                subactivity = ?,
                desc_ceo = ?,
                desc_ceo_1 = ?,
                desc_ceo_2 = ?,
                desc_ceo_3 = ?,
                desc_ceo_4 = ?,
                desc_ceo_5 = ?,
                desc_ceo_6 = ?,
                desc_ceo_7 = ?
            WHERE id = ?
        `;
        
        const updateParams = [
            department_name.trim(),
            division?.trim() || null,
            subactivity?.trim() || null,
            desc_ceo?.trim() || null,
            desc_ceo_1?.trim() || null,
            desc_ceo_2?.trim() || null,
            desc_ceo_3?.trim() || null,
            desc_ceo_4?.trim() || null,
            desc_ceo_5?.trim() || null,
            desc_ceo_6?.trim() || null,
            desc_ceo_7?.trim() || null,
            id
        ];
        
        console.log('  Query:', updateQuery.replace(/\s+/g, ' ').trim());
        console.log('  Parámetros:', JSON.stringify(updateParams, null, 2));
        
        // 🚀 Ejecutar actualización
        console.log('');
        console.log('🚀 Ejecutando UPDATE...');
        const result = await executeQuery(equipmentPool, updateQuery, updateParams);
        
        console.log('✅ UPDATE ejecutado');
        console.log('📊 Resultado:');
        console.log(`  - affectedRows: ${result.affectedRows}`);
        console.log(`  - changedRows: ${result.changedRows}`);
        console.log(`  - warningCount: ${result.warningCount}`);
        
        // 🔍 Verificar estado después
        console.log('');
        console.log('🔍 Verificando estado después del UPDATE...');
        const after = await executeQuery(equipmentPool, checkQuery, [id]);
        console.log('📊 Estado DESPUÉS de actualizar:');
        console.log(JSON.stringify(after[0], null, 2));
        
        // 📊 Comparación de cambios
        console.log('');
        console.log('🔄 COMPARACIÓN DE CAMBIOS:');
        const compareFields = ['department_name', 'division', 'subactivity', 'desc_ceo_4'];
        compareFields.forEach(field => {
            const beforeVal = before[0][field] || 'NULL';
            const afterVal = after[0][field] || 'NULL';
            const changed = beforeVal !== afterVal ? '✅ CAMBIÓ' : '⚪ Sin cambios';
            console.log(`  ${field}: "${beforeVal}" → "${afterVal}" ${changed}`);
        });
        
        console.log('═══════════════════════════════════════════════\n');
        
        // ✅ Respuesta exitosa
        if (result.affectedRows > 0) {
            const message = result.changedRows > 0 
                ? `Departamento actualizado correctamente. ${result.changedRows} campo(s) modificado(s).`
                : 'Departamento procesado. No hubo cambios (valores idénticos a los actuales).';
            
            return res.json({ 
                success: true, 
                message: message,
                affectedRows: result.affectedRows,
                changedRows: result.changedRows,
                data: after[0]
            });
        } else {
            return res.status(404).json({ 
                success: false, 
                message: 'No se pudo actualizar el departamento (affectedRows = 0)' 
            });
        }
        
    } catch (error) {
        console.error('\n❌❌❌ ERROR CAPTURADO ❌❌❌');
        console.error('Tipo:', error.name);
        console.error('Mensaje:', error.message);
        console.error('Code:', error.code);
        console.error('Errno:', error.errno);
        console.error('SQL State:', error.sqlState);
        console.error('SQL Message:', error.sqlMessage);
        console.error('Stack:', error.stack);
        console.error('═══════════════════════════════════════════════\n');
        
        return res.status(500).json({ 
            success: false, 
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// GET /api/departments/:id - Obtener departamento por ID (DEBE IR DESPUÉS DE /search)
router.get('/:id',
  [
    param('id').isInt({ min: 1 }),
    validate
  ],
  async (req, res, next) => {
    try {
      const queryStr = 'SELECT * FROM departments WHERE id = ?';
      const results = await executeQuery(equipmentPool, queryStr, [req.params.id]);
      
      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Departamento no encontrado'
        });
      }

      res.json({
        success: true,
        data: results[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/departments - Crear departamento
router.post('/',
  [
    body('department_name').notEmpty().withMessage('Nombre de departamento requerido'),
    validate
  ],
  async (req, res, next) => {
    try {
      const {
        department_name, division, subactivity,
        desc_ceo, desc_ceo_1, desc_ceo_2, desc_ceo_3,
        desc_ceo_4, desc_ceo_5, desc_ceo_6, desc_ceo_7
      } = req.body;

      const queryStr = `
        INSERT INTO departments 
        (department_name, division, subactivity, desc_ceo, desc_ceo_1, 
         desc_ceo_2, desc_ceo_3, desc_ceo_4, desc_ceo_5, desc_ceo_6, desc_ceo_7)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await executeQuery(equipmentPool, queryStr, [
        department_name,
        division || null,
        subactivity || null,
        desc_ceo || null,
        desc_ceo_1 || null,
        desc_ceo_2 || null,
        desc_ceo_3 || null,
        desc_ceo_4 || null,
        desc_ceo_5 || null,
        desc_ceo_6 || null,
        desc_ceo_7 || null
      ]);

      res.status(201).json({
        success: true,
        message: 'Departamento creado exitosamente',
        data: { id: result.insertId }
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
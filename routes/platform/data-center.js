'use strict';

// ============================================================================
// routes/platform/data-center.js
// Centro de Gestión de Datos — plantillas, exportación, import upsert, historial
// ============================================================================

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const Papa    = require('papaparse');
const { authenticateToken } = require('../../middleware/auth');
const { checkPermission }   = require('../../middleware/permissions');
const { executeQuery, equipmentPool } = require('../../config/database');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../src/config/database');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Helpers ──────────────────────────────────────────────────────────────────

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => csvEscape(r[h])).join(',')),
  ];
  return '﻿' + lines.join('\r\n'); // BOM para Excel
}

function parseCSV(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const result = Papa.parse(text, {
    header: true, skipEmptyLines: true, trimHeaders: true,
    transform: v => (typeof v === 'string' ? v.trim() : v),
  });
  return { data: result.data, errors: result.errors };
}

async function qRaw(sql, params = []) {
  return executeQuery(equipmentPool, sql, params);
}

async function qInsert(sql, params = []) {
  const [id] = await sequelize.query(sql, { replacements: params, type: QueryTypes.INSERT });
  return id;
}

async function logUpload({ tenantId, userId, entity, total, inserted, updated, errored, errorFile }) {
  try {
    await qRaw(
      `INSERT IGNORE INTO upload_logs (tenant_id, user_id, entity, total, inserted, updated, errored, error_file, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [tenantId, userId, entity, total, inserted, updated, errored, errorFile || null]
    );
  } catch (_) {}
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const SCHEMAS = {
  employees: {
    label:   'Empleados',
    key:     'cip',
    altKey:  'email',
    table:   'employees',
    columns: ['cip','full_name','email','department_name','position','position_name',
              'category','employee_group','state','supervisor_name','cost_center','is_active'],
    required: ['full_name','email'],
    examples: [
      { cip:'12345678', full_name:'Juan Pérez García', email:'juan.perez@empresa.com',
        department_name:'Tecnología', position:'Analista de Sistemas', position_name:'Analista TI',
        category:'Operativo', employee_group:'Staff', state:'Lima',
        supervisor_name:'María Rodríguez', cost_center:'CC-001', is_active:'1' },
      { cip:'87654321', full_name:'Ana Torres López', email:'ana.torres@empresa.com',
        department_name:'Soporte', position:'Técnico de Soporte', position_name:'Técnico N1',
        category:'Operativo', employee_group:'Staff', state:'Lima',
        supervisor_name:'Carlos Gómez', cost_center:'CC-002', is_active:'1' },
    ],
    exportSql: tId => `
      SELECT e.cip, e.full_name, e.email,
             (SELECT department_name FROM departments d WHERE d.id = e.department_id LIMIT 1) AS department_name,
             e.position, e.position_name, e.category, e.employee_group,
             e.state, e.supervisor_name, e.cost_center,
             IF(e.is_active,1,0) AS is_active
      FROM employees e
      WHERE e.tenant_id = ${tId} AND e.deleted_at IS NULL
      ORDER BY e.full_name`,
    upsert: async (row, tenantId) => {
      const key   = row.cip   ? row.cip.trim()   : null;
      const email = row.email ? row.email.trim().toLowerCase() : null;
      if (!row.full_name?.trim())   return { action: 'error', reason: 'full_name es requerido' };
      if (!email)                   return { action: 'error', reason: 'email es requerido' };

      // Resolver department_id
      let deptId = null;
      if (row.department_name?.trim()) {
        const [d] = await qRaw('SELECT id FROM departments WHERE department_name = ? AND tenant_id = ? LIMIT 1',
          [row.department_name.trim(), tenantId]);
        if (d) deptId = d.id;
      }

      const isActive = row.is_active === undefined ? 1 : (String(row.is_active).trim() === '0' ? 0 : 1);

      // Buscar existente por cip o email dentro del tenant
      const condition = key
        ? `(cip = ? OR email = ?) AND tenant_id = ?`
        : `email = ? AND tenant_id = ?`;
      const params = key ? [key, email, tenantId] : [email, tenantId];
      const [existing] = await qRaw(`SELECT id FROM employees WHERE ${condition} LIMIT 1`, params);

      if (existing) {
        await qRaw(`UPDATE employees SET full_name=?, email=?, department_id=?, position=?,
                    position_name=?, category=?, employee_group=?, state=?,
                    supervisor_name=?, cost_center=?, is_active=?, updated_at=NOW()
                    WHERE id=?`,
          [row.full_name.trim(), email, deptId, row.position||null, row.position_name||null,
           row.category||null, row.employee_group||null, row.state||null,
           row.supervisor_name||null, row.cost_center||null, isActive, existing.id]);
        return { action: 'updated' };
      }

      await qInsert(`INSERT INTO employees (cip,full_name,email,department_id,position,position_name,
                    category,employee_group,state,supervisor_name,cost_center,is_active,tenant_id,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
        [key, row.full_name.trim(), email, deptId, row.position||null, row.position_name||null,
         row.category||null, row.employee_group||null, row.state||null,
         row.supervisor_name||null, row.cost_center||null, isActive, tenantId]);
      return { action: 'inserted' };
    },
  },

  equipment: {
    label:   'Equipos',
    key:     'device_code',
    table:   'equipment',
    columns: ['device_code','serial_number','equipment_type','brand','model',
              'operating_system','processor','ram_memory','disk_capacity',
              'status','domain','obsolescence_years'],
    required: ['device_code'],
    examples: [
      { device_code:'LPT-001', serial_number:'SN123456', equipment_type:'Laptop',
        brand:'Dell', model:'Latitude 5520', operating_system:'Windows 11',
        processor:'Intel Core i5-1135G7', ram_memory:'16GB', disk_capacity:'512GB SSD',
        status:'Operativo', domain:'INTEGRATEL', obsolescence_years:'2027' },
      { device_code:'DKT-002', serial_number:'SN789012', equipment_type:'Desktop',
        brand:'HP', model:'EliteDesk 800', operating_system:'Windows 10',
        processor:'Intel Core i7-10700', ram_memory:'32GB', disk_capacity:'1TB SSD',
        status:'Operativo', domain:'INTEGRATEL', obsolescence_years:'2026' },
    ],
    exportSql: tId => `
      SELECT device_code, serial_number, equipment_type, brand, model,
             operating_system, processor, ram_memory, disk_capacity,
             status, domain, obsolescence_years
      FROM equipment
      WHERE tenant_id = ${tId} AND deleted_at IS NULL
      ORDER BY device_code`,
    upsert: async (row, tenantId) => {
      const code = row.device_code?.trim();
      if (!code) return { action: 'error', reason: 'device_code es requerido' };

      const [existing] = await qRaw(
        'SELECT id FROM equipment WHERE device_code = ? AND tenant_id = ? LIMIT 1',
        [code, tenantId]
      );

      const fields = {
        serial_number:      row.serial_number     || null,
        equipment_type:     row.equipment_type     || 'Otro',
        brand:              row.brand              || null,
        model:              row.model              || null,
        operating_system:   row.operating_system   || null,
        processor:          row.processor          || null,
        ram_memory:         row.ram_memory         || null,
        disk_capacity:      row.disk_capacity      || null,
        status:             row.status             || 'Operativo',
        domain:             row.domain             || null,
        obsolescence_years: row.obsolescence_years ? parseInt(row.obsolescence_years) : null,
      };

      if (existing) {
        const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
        await qRaw(
          `UPDATE equipment SET ${sets}, updated_at=NOW() WHERE id=?`,
          [...Object.values(fields), existing.id]
        );
        return { action: 'updated' };
      }

      const cols = ['device_code', 'tenant_id', ...Object.keys(fields), 'created_at', 'updated_at'];
      const vals = [code, tenantId, ...Object.values(fields), new Date(), new Date()];
      await qInsert(
        `INSERT INTO equipment (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        vals
      );
      return { action: 'inserted' };
    },
  },

  assignments: {
    label:   'Asignaciones',
    key:     null,
    table:   'assignments',
    columns: ['employee_cip','device_code','assignment_date','notes'],
    required: ['employee_cip','device_code'],
    examples: [
      { employee_cip:'12345678', device_code:'LPT-001',
        assignment_date:'2025-01-15', notes:'Asignación inicial' },
      { employee_cip:'87654321', device_code:'DKT-002',
        assignment_date:'2025-02-01', notes:'' },
    ],
    exportSql: tId => `
      SELECT e.cip AS employee_cip, eq.device_code,
             DATE_FORMAT(a.assignment_date,'%Y-%m-%d') AS assignment_date,
             a.notes
      FROM assignments a
      JOIN employees e  ON a.employee_id  = e.id
      JOIN equipment eq ON a.equipment_id = eq.id
      WHERE a.tenant_id = ${tId} AND a.status = 'Activo'
      ORDER BY a.assignment_date DESC`,
    upsert: async (row, tenantId) => {
      const cip  = row.employee_cip?.trim();
      const code = row.device_code?.trim();
      if (!cip)  return { action: 'error', reason: 'employee_cip es requerido' };
      if (!code) return { action: 'error', reason: 'device_code es requerido' };

      const [emp] = await qRaw(
        'SELECT id FROM employees WHERE cip = ? AND tenant_id = ? LIMIT 1',
        [cip, tenantId]
      );
      if (!emp) return { action: 'error', reason: `Empleado CIP ${cip} no encontrado` };

      const [eq] = await qRaw(
        'SELECT id FROM equipment WHERE device_code = ? AND tenant_id = ? LIMIT 1',
        [code, tenantId]
      );
      if (!eq) return { action: 'error', reason: `Equipo ${code} no encontrado` };

      // Detectar si el equipo ya está asignado a OTRO empleado
      const [conflict] = await qRaw(
        `SELECT a.id, e2.full_name AS current_employee
         FROM assignments a JOIN employees e2 ON e2.id = a.employee_id
         WHERE a.equipment_id=? AND a.status='Activo' AND a.tenant_id=? AND a.employee_id != ? LIMIT 1`,
        [eq.id, tenantId, emp.id]
      );
      if (conflict) return { action: 'error', reason: `Equipo ${code} ya está asignado a ${conflict.current_employee} — debe devolverse antes` };

      // Si ya existe asignación activa entre este empleado y este equipo, actualizar notas
      const [existing] = await qRaw(
        `SELECT id FROM assignments WHERE employee_id=? AND equipment_id=? AND status='Activo' AND tenant_id=? LIMIT 1`,
        [emp.id, eq.id, tenantId]
      );
      if (existing) {
        if (row.notes !== undefined) {
          await qRaw('UPDATE assignments SET notes=?, updated_at=NOW() WHERE id=?', [row.notes||null, existing.id]);
          return { action: 'updated' };
        }
        return { action: 'skipped', reason: 'Asignación activa ya existe' };
      }

      const aDate = row.assignment_date || new Date().toISOString().slice(0, 10);
      await qInsert(
        `INSERT INTO assignments (employee_id, equipment_id, assignment_date, status, notes, tenant_id, created_at, updated_at)
         VALUES (?, ?, ?, 'Activo', ?, ?, NOW(), NOW())`,
        [emp.id, eq.id, aDate, row.notes || null, tenantId]
      );
      return { action: 'inserted' };
    },
  },
};

// ── Asegurar tabla upload_logs ────────────────────────────────────────────────

(async () => {
  try {
    await qRaw(`
      CREATE TABLE IF NOT EXISTS upload_logs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id  INT NOT NULL DEFAULT 1,
        user_id    INT,
        entity     VARCHAR(50) NOT NULL,
        total      INT DEFAULT 0,
        inserted   INT DEFAULT 0,
        updated    INT DEFAULT 0,
        errored    INT DEFAULT 0,
        error_file MEDIUMTEXT,
        created_at DATETIME DEFAULT NOW()
      )
    `);
  } catch (_) {}
})();

// ============================================================================
// EQUIPMENT-FULL — CSV plano: equipos + asignaciones en una sola tabla
// ============================================================================

const EQ_FULL_COLS = [
  'device_code','serial_number','equipment_type','brand','model',
  'operating_system','processor','ram_memory','disk_capacity',
  'status','domain','obsolescence_years',
  'employee_cip','employee_name','employee_email','assignment_date','notes',
];

const EQ_FULL_EXAMPLES = [
  { device_code:'LPT-001', serial_number:'SN123456', equipment_type:'Laptop',
    brand:'Dell', model:'Latitude 5520', operating_system:'Windows 11',
    processor:'Intel Core i5-1135G7', ram_memory:'16GB', disk_capacity:'512GB SSD',
    status:'Operativo', domain:'INTEGRATEL', obsolescence_years:'2027',
    employee_cip:'12345678', employee_name:'Juan Pérez García', employee_email:'juan.perez@empresa.com',
    assignment_date:'2025-01-15', notes:'Asignación inicial' },
  { device_code:'DKT-002', serial_number:'SN789012', equipment_type:'Desktop',
    brand:'HP', model:'EliteDesk 800', operating_system:'Windows 10',
    processor:'Intel Core i7-10700', ram_memory:'32GB', disk_capacity:'1TB SSD',
    status:'Disponible', domain:'INTEGRATEL', obsolescence_years:'2026',
    employee_cip:'', employee_name:'', employee_email:'', assignment_date:'', notes:'' },
];

const EQ_FULL_EXPORT_SQL = tId => `
  SELECT eq.device_code, eq.serial_number, eq.equipment_type, eq.brand, eq.model,
         eq.operating_system, eq.processor, eq.ram_memory, eq.disk_capacity,
         eq.status, eq.domain, eq.obsolescence_years,
         COALESCE(emp.cip,'')        AS employee_cip,
         COALESCE(emp.full_name,'')  AS employee_name,
         COALESCE(emp.email,'')      AS employee_email,
         COALESCE(DATE_FORMAT(a.assignment_date,'%Y-%m-%d'),'') AS assignment_date,
         COALESCE(a.notes,'')        AS notes
  FROM equipment eq
  LEFT JOIN assignments a   ON a.equipment_id = eq.id AND a.status = 'Activo' AND a.tenant_id = ${tId}
  LEFT JOIN employees   emp ON emp.id = a.employee_id
  WHERE eq.tenant_id = ${tId} AND eq.deleted_at IS NULL
  ORDER BY eq.device_code`;

async function upsertEqFull(row, tenantId) {
  const code = row.device_code?.trim();
  if (!code) return { eqAction: 'error', eqReason: 'device_code es requerido' };

  const eqResult = await SCHEMAS.equipment.upsert(row, tenantId);
  if (eqResult.action === 'error') return { eqAction: 'error', eqReason: eqResult.reason };

  const cip = row.employee_cip?.trim();
  if (!cip) return { eqAction: eqResult.action, asgAction: 'skipped' };

  const asgResult = await SCHEMAS.assignments.upsert({
    employee_cip: cip, device_code: code,
    assignment_date: row.assignment_date || '', notes: row.notes || '',
  }, tenantId);

  return { eqAction: eqResult.action, asgAction: asgResult.action, asgReason: asgResult.reason };
}

router.get('/equipment-full/template', authenticateToken, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla_inventario_completo_${date}.csv"`);
  res.send(toCSV(EQ_FULL_EXAMPLES));
});

router.get('/equipment-full/export', authenticateToken, async (req, res) => {
  const tenantId = parseInt(req.user?.tenant_id || 1);
  const date = new Date().toISOString().slice(0, 10);
  try {
    const rows = await qRaw(EQ_FULL_EXPORT_SQL(tenantId));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventario_completo_${date}.csv"`);
    res.send(toCSV(rows.length ? rows : [Object.fromEntries(EQ_FULL_COLS.map(c => [c, '']))]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/equipment-full/upload', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const tenantId = parseInt(req.user?.tenant_id || 1);
  const { data } = parseCSV(req.file.buffer);

  let eqIns=0, eqUpd=0, eqErr=0, asgIns=0, asgUpd=0, asgSkip=0, asgErr=0;
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    try {
      const r = await upsertEqFull(row, tenantId);
      if (r.eqAction === 'error') {
        eqErr++;
        errors.push({ row:i+2, device_code:row.device_code||'—', tipo:'Equipo', motivo:r.eqReason });
        continue;
      }
      if (r.eqAction === 'inserted') eqIns++; else eqUpd++;
      if      (r.asgAction === 'inserted') asgIns++;
      else if (r.asgAction === 'updated')  asgUpd++;
      else if (r.asgAction === 'skipped')  asgSkip++;
      else if (r.asgAction === 'error') {
        asgErr++;
        errors.push({ row:i+2, device_code:row.device_code||'—', tipo:'Asignación', motivo:r.asgReason });
      }
    } catch(e) {
      eqErr++;
      errors.push({ row:i+2, device_code:row.device_code||'—', tipo:'Sistema', motivo:e.message });
    }
  }

  res.json({ success:true, total:data.length,
    eq:  { inserted:eqIns,  updated:eqUpd,  errored:eqErr },
    asg: { inserted:asgIns, updated:asgUpd, skipped:asgSkip, errored:asgErr },
    errors,
  });
});

router.post('/equipment-full/commit', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const tenantId = parseInt(req.user?.tenant_id || 1);
  const { data } = parseCSV(req.file.buffer);

  let eqIns=0, eqUpd=0, eqErr=0, asgIns=0, asgUpd=0, asgSkip=0, asgErr=0;
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    try {
      const r = await upsertEqFull(row, tenantId);
      if (r.eqAction === 'error') {
        eqErr++;
        errors.push({ row:i+2, device_code:row.device_code||'—', tipo:'Equipo', motivo:r.eqReason });
        continue;
      }
      if (r.eqAction === 'inserted') eqIns++; else eqUpd++;
      if      (r.asgAction === 'inserted') asgIns++;
      else if (r.asgAction === 'updated')  asgUpd++;
      else if (r.asgAction === 'skipped')  asgSkip++;
      else if (r.asgAction === 'error') {
        asgErr++;
        errors.push({ row:i+2, device_code:row.device_code||'—', tipo:'Asignación', motivo:r.asgReason });
      }
    } catch(e) {
      eqErr++;
      errors.push({ row:i+2, device_code:row.device_code||'—', tipo:'Sistema', motivo:e.message });
    }
  }

  await logUpload({ tenantId, userId:req.user?.id, entity:'equipment_full',
    total:data.length, inserted:eqIns+asgIns, updated:eqUpd+asgUpd, errored:eqErr+asgErr,
    errorFile: errors.length ? JSON.stringify(errors) : null });

  res.json({ success:true, total:data.length,
    eq:  { inserted:eqIns,  updated:eqUpd,  errored:eqErr },
    asg: { inserted:asgIns, updated:asgUpd, skipped:asgSkip, errored:asgErr },
    errors,
  });
});

// ============================================================================
// BULK-TOTAL — CSV unificado con secciones [EMPLEADOS] [EQUIPOS] [ASIGNACIONES]
// ============================================================================

function parseCombinedCSV(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const sectionMap = {
    '[EMPLEADOS]':     'employees',
    '[EQUIPOS]':       'equipment',
    '[ASIGNACIONES]':  'assignments',
  };
  const buckets = { employees: [], equipment: [], assignments: [] };
  let current = null;
  for (const line of lines) {
    const t = line.trim();
    if (sectionMap[t]) { current = sectionMap[t]; }
    else if (current) { buckets[current].push(line); }
  }
  const result = {};
  for (const [key, blines] of Object.entries(buckets)) {
    if (blines.length < 2) { result[key] = []; continue; }
    const p = Papa.parse(blines.join('\n'), {
      header: true, skipEmptyLines: true, trimHeaders: true,
      transform: v => (typeof v === 'string' ? v.trim() : v),
    });
    result[key] = p.data;
  }
  return result;
}

router.get('/bulk-total/template', authenticateToken, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const order   = ['employees', 'equipment', 'assignments'];
  const markers = { employees: '[EMPLEADOS]', equipment: '[EQUIPOS]', assignments: '[ASIGNACIONES]' };
  let csv = '﻿';
  for (const key of order) {
    const s      = SCHEMAS[key];
    const header = s.columns.join(',');
    const rows   = s.examples.map(ex => s.columns.map(c => csvEscape(ex[c] ?? '')).join(','));
    csv += markers[key] + '\r\n' + header + '\r\n' + rows.join('\r\n') + '\r\n\r\n';
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla_completa_${date}.csv"`);
  res.send(csv);
});

router.get('/bulk-total/export', authenticateToken, async (req, res) => {
  const tenantId = parseInt(req.user?.tenant_id || 1);
  const date     = new Date().toISOString().slice(0, 10);
  const order    = ['employees', 'equipment', 'assignments'];
  const markers  = { employees: '[EMPLEADOS]', equipment: '[EQUIPOS]', assignments: '[ASIGNACIONES]' };
  try {
    let csv = '﻿';
    for (const key of order) {
      const rows = await qRaw(SCHEMAS[key].exportSql(tenantId));
      csv += markers[key] + '\r\n' + toCSV(rows).replace(/^﻿/, '') + '\r\n\r\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="datos_completos_${date}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-total/upload', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const tenantId = parseInt(req.user?.tenant_id || 1);
  const sections = parseCombinedCSV(req.file.buffer);
  const order    = ['employees', 'equipment', 'assignments'];
  const results  = {};

  for (const key of order) {
    const schema = SCHEMAS[key];
    const data   = sections[key];
    if (!data.length) {
      results[key] = { total: 0, toInsert: 0, toUpdate: 0, toSkip: 0, toError: 0, preview: [] };
      continue;
    }
    let toInsert = 0, toUpdate = 0, toSkip = 0, toError = 0;
    const preview = [];
    for (let i = 0; i < data.length; i++) {
      const row     = data[i];
      const missing = schema.required.filter(f => !row[f]?.trim());
      if (missing.length) {
        toError++;
        preview.push({ row: i + 2, action: 'error', key: '—', reason: `Campos vacíos: ${missing.join(', ')}` });
        continue;
      }
      try {
        const r = await schema.upsert(row, tenantId);
        if      (r.action === 'inserted') { toInsert++; preview.push({ row: i+2, action: 'insert', key: row[schema.key || schema.columns[0]] }); }
        else if (r.action === 'updated')  { toUpdate++; preview.push({ row: i+2, action: 'update', key: row[schema.key || schema.columns[0]] }); }
        else if (r.action === 'skipped')  { toSkip++; }
        else { toError++; preview.push({ row: i+2, action: 'error', key: row[schema.key || schema.columns[0]], reason: r.reason }); }
      } catch (e) { toError++; preview.push({ row: i+2, action: 'error', key: '—', reason: e.message }); }
    }
    results[key] = { total: data.length, toInsert, toUpdate, toSkip, toError, preview: preview.slice(0, 20) };
  }
  res.json({ success: true, results });
});

router.post('/bulk-total/commit', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const tenantId = parseInt(req.user?.tenant_id || 1);
  const sections = parseCombinedCSV(req.file.buffer);
  const order    = ['employees', 'equipment', 'assignments'];
  const summary  = {};

  for (const key of order) {
    const schema = SCHEMAS[key];
    const data   = sections[key];
    let inserted = 0, updated = 0, skipped = 0, errored = 0;
    const errorRows = [];
    for (let i = 0; i < data.length; i++) {
      const row     = data[i];
      const missing = schema.required.filter(f => !row[f]?.trim());
      if (missing.length) { errored++; errorRows.push({ row: i+2, reason: `Campos vacíos: ${missing.join(', ')}` }); continue; }
      try {
        const r = await schema.upsert(row, tenantId);
        if      (r.action === 'inserted') inserted++;
        else if (r.action === 'updated')  updated++;
        else if (r.action === 'skipped')  skipped++;
        else { errored++; errorRows.push({ row: i+2, reason: r.reason }); }
      } catch (e) { errored++; errorRows.push({ row: i+2, reason: e.message }); }
    }
    await logUpload({ tenantId, userId: req.user?.id, entity: key,
      total: data.length, inserted, updated, errored,
      errorFile: errorRows.length ? JSON.stringify(errorRows) : null });
    summary[key] = { total: data.length, inserted, updated, skipped, errored };
  }
  res.json({ success: true, summary });
});

// ============================================================================
// GET /api/data-center/:entity/template — Descargar plantilla CSV con ejemplos
// ============================================================================
router.get('/:entity/template', authenticateToken, (req, res) => {
  const schema = SCHEMAS[req.params.entity];
  if (!schema) return res.status(400).json({ error: 'Entidad inválida' });

  const csv  = toCSV(schema.examples);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla_${req.params.entity}_${date}.csv"`);
  res.send(csv);
});

// ============================================================================
// GET /api/data-center/:entity/export — Exportar data actual del tenant
// ============================================================================
router.get('/:entity/export', authenticateToken, async (req, res) => {
  const schema = SCHEMAS[req.params.entity];
  if (!schema) return res.status(400).json({ error: 'Entidad inválida' });

  const tenantId = parseInt(req.user?.tenant_id || 1);
  try {
    const rows = await qRaw(schema.exportSql(tenantId));
    const csv  = toCSV(rows);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}_${date}.csv"`);
    res.send(csv || '﻿');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /api/data-center/:entity/upload — Parsear + validar → devuelve preview
// ============================================================================
router.post('/:entity/upload', authenticateToken, upload.single('file'), async (req, res) => {
  const schema = SCHEMAS[req.params.entity];
  if (!schema) return res.status(400).json({ error: 'Entidad inválida' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  const tenantId = parseInt(req.user?.tenant_id || 1);
  const { data, errors: parseErrors } = parseCSV(req.file.buffer);

  if (parseErrors.length && !data.length) {
    return res.status(400).json({ error: 'Error al parsear CSV', details: parseErrors });
  }

  const preview = [];
  let toInsert = 0, toUpdate = 0, toSkip = 0, toError = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2; // +1 header, +1 base-1

    // Validación de requeridos
    const missing = schema.required.filter(f => !row[f]?.trim());
    if (missing.length) {
      preview.push({ row: rowNum, action: 'error', reason: `Campos requeridos vacíos: ${missing.join(', ')}`, data: row });
      toError++;
      continue;
    }

    // Detección rápida de duplicado para el preview (sin escribir en BD)
    let action = 'insert';
    try {
      if (schema.key && row[schema.key]) {
        const [ex] = await qRaw(
          `SELECT id FROM \`${schema.table}\` WHERE \`${schema.key}\` = ? AND tenant_id = ? LIMIT 1`,
          [row[schema.key].trim(), tenantId]
        );
        if (ex) action = 'update';
      } else if (schema.altKey && row[schema.altKey] && schema.table === 'employees') {
        const [ex] = await qRaw(
          `SELECT id FROM employees WHERE email = ? AND tenant_id = ? LIMIT 1`,
          [row[schema.altKey].trim().toLowerCase(), tenantId]
        );
        if (ex) action = 'update';
      } else if (schema.table === 'assignments') {
        const [emp] = await qRaw('SELECT id FROM employees WHERE cip=? AND tenant_id=? LIMIT 1',
          [row.employee_cip?.trim(), tenantId]);
        const [eq] = await qRaw('SELECT id FROM equipment WHERE device_code=? AND tenant_id=? LIMIT 1',
          [row.device_code?.trim(), tenantId]);
        if (emp && eq) {
          const [ex] = await qRaw(
            `SELECT id FROM assignments WHERE employee_id=? AND equipment_id=? AND status='Activo' AND tenant_id=? LIMIT 1`,
            [emp.id, eq.id, tenantId]
          );
          if (ex) action = 'skip';
          else {
            // Detectar si el equipo ya está asignado a OTRO empleado (conflicto)
            const [conflict] = await qRaw(
              `SELECT a.id, e2.full_name AS current_employee
               FROM assignments a JOIN employees e2 ON e2.id = a.employee_id
               WHERE a.equipment_id=? AND a.status='Activo' AND a.tenant_id=? AND a.employee_id != ? LIMIT 1`,
              [eq.id, tenantId, emp.id]
            );
            if (conflict) action = 'error';
          }
        }
      }
    } catch (_) {}

    if (action === 'insert') toInsert++;
    else if (action === 'update') toUpdate++;
    else toSkip++;

    preview.push({ row: rowNum, action, data: row });
  }

  res.json({
    success: true,
    total:    data.length,
    toInsert, toUpdate, toSkip, toError,
    preview:  preview.slice(0, 200), // max 200 filas en preview
    hasMore:  preview.length > 200,
  });
});

// ============================================================================
// POST /api/data-center/:entity/commit — Aplicar upsert real
// ============================================================================
router.post('/:entity/commit', authenticateToken, upload.single('file'), async (req, res) => {
  const schema = SCHEMAS[req.params.entity];
  if (!schema) return res.status(400).json({ error: 'Entidad inválida' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  const tenantId = parseInt(req.user?.tenant_id || 1);
  const { data } = parseCSV(req.file.buffer);

  let inserted = 0, updated = 0, skipped = 0, errored = 0;
  const errorRows = [];

  for (let i = 0; i < data.length; i++) {
    const row    = data[i];
    const rowNum = i + 2;

    const missing = schema.required.filter(f => !row[f]?.trim());
    if (missing.length) {
      errored++;
      errorRows.push({ row: rowNum, reason: `Campos requeridos vacíos: ${missing.join(', ')}` });
      continue;
    }

    try {
      const result = await schema.upsert(row, tenantId);
      if (result.action === 'inserted') inserted++;
      else if (result.action === 'updated') updated++;
      else if (result.action === 'skipped') skipped++;
      else { errored++; errorRows.push({ row: rowNum, reason: result.reason }); }
    } catch (err) {
      errored++;
      errorRows.push({ row: rowNum, reason: err.message });
    }
  }

  // Guardar en historial
  const errorFile = errorRows.length ? JSON.stringify(errorRows) : null;
  await logUpload({
    tenantId,
    userId:    req.user?.id,
    entity:    req.params.entity,
    total:     data.length,
    inserted, updated, errored,
    errorFile,
  });

  res.json({
    success: true,
    total:   data.length,
    inserted, updated, skipped, errored,
    errorRows: errorRows.slice(0, 100),
  });
});

// ============================================================================
// GET /api/data-center/history — Historial de cargas del tenant
// ============================================================================
router.get('/history', authenticateToken, async (req, res) => {
  const tenantId = parseInt(req.user?.tenant_id || 1);
  try {
    const rows = await qRaw(`
      SELECT ul.id, ul.entity, ul.total, ul.inserted, ul.updated, ul.errored,
             ul.created_at,
             COALESCE(u.full_name, u.email, 'Sistema') AS uploaded_by
      FROM upload_logs ul
      LEFT JOIN users u ON u.id = ul.user_id
      WHERE ul.tenant_id = ?
      ORDER BY ul.created_at DESC
      LIMIT 50
    `, [tenantId]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// ============================================================================
// GET /api/data-center/stats — Conteos actuales por entidad
// ============================================================================
router.get('/stats', authenticateToken, async (req, res) => {
  const tenantId = parseInt(req.user?.tenant_id || 1);
  try {
    const [[emp], [eq], [asn]] = await Promise.all([
      qRaw('SELECT COUNT(*) AS cnt FROM employees WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL', [tenantId]),
      qRaw('SELECT COUNT(*) AS cnt FROM equipment  WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]),
      qRaw(`SELECT COUNT(*) AS cnt FROM assignments WHERE tenant_id=? AND status='Activo'`, [tenantId]),
    ]);
    res.json({ success: true, data: {
      employees:   emp?.cnt  || 0,
      equipment:   eq?.cnt   || 0,
      assignments: asn?.cnt  || 0,
    }});
  } catch (err) {
    res.json({ success: true, data: { employees: 0, equipment: 0, assignments: 0 } });
  }
});

module.exports = router;

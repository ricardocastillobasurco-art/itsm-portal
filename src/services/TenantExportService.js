'use strict';

// Exportación completa de los datos de una empresa (portabilidad / fin de contrato).
//
// Genera un ZIP con:
//   data/<tabla>.json y data/<tabla>.csv  → filas de la empresa
//   archivos/<clave>/...                   → adjuntos locales (opcional)
//   manifest.json + LEEME.txt              → qué incluye, qué se excluyó y por qué
//
// - Tablas con tenant_id: filas de la empresa (la empresa 1 incluye tenant_id NULL).
// - Tablas hijas sin tenant_id (comentarios, historial, adjuntos, encuestas,
//   pasos de flujos): por la clave de sus tickets / plantillas.
// - Nunca se exportan secretos: contraseñas, tokens, sesiones, cachés de
//   credenciales; columnas sensibles se reemplazan por "[omitido]".

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { executeQuery, equipmentPool } = require('../../config/database');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const BATCH = 5000;
const UPLOADS_DIR = path.join(__dirname, '../../uploads/tickets');

// Tablas que no se exportan (seguridad o internas de la plataforma)
const EXCLUDED = {
  sessions: 'sesiones activas', refresh_tokens: 'tokens de sesión', password_resets: 'códigos de recuperación',
  auth_email_codes: 'códigos de verificación', login_attempts: 'registro de seguridad de la plataforma',
  sequelize_meta: 'interna', SequelizeMeta: 'interna', job_queue: 'interna', dashboard_stats_cache: 'caché recalculable',
  tenant_billing: 'facturación de la plataforma (se entrega por separado)',
};
// Columnas con secretos: se reemplazan
const SECRET_COL = /(^|_)(password|passwd|pass|secret|token|api_key|apikey|private_key|hash|salt|token_cache|refresh)(_|$)/i;

// Tablas hijas: [tabla, columna, origen de las claves]
const CHILDREN = [
  ['ticket_comments',    'ticket_id', 'ticketKeys'],
  ['ticket_history',     'ticket_id', 'ticketKeys'],
  ['ticket_attachments', 'ticket_id', 'ticketKeys'],
  ['ticket_surveys',     'ticket_id', 'ticketKeys'],
  ['workflow_template_steps', 'template_id', 'workflowTemplateIds'],
];

function _csvCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) v = v.toISOString();
  else if (Buffer.isBuffer(v)) v = v.toString('base64');
  else if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;            // evita fórmulas al abrir en Excel
  return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function _sanitize(rows, redacted, table) {
  if (!rows.length) return rows;
  const secretCols = Object.keys(rows[0]).filter(c => SECRET_COL.test(c));
  if (!secretCols.length) return rows;
  secretCols.forEach(c => redacted.add(`${table}.${c}`));
  return rows.map(r => { const o = { ...r }; secretCols.forEach(c => { if (o[c] !== null && o[c] !== undefined) o[c] = '[omitido]'; }); return o; });
}

async function _tablesWithTenant() {
  const rows = await q(`SELECT c.TABLE_NAME AS t FROM information_schema.COLUMNS c
                        JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
                        WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'tenant_id' AND tb.TABLE_TYPE = 'BASE TABLE'
                        ORDER BY c.TABLE_NAME`);
  return rows.map(r => r.t || r.TABLE_NAME);
}

async function _tableExists(t) {
  const [r] = await q('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
  return Number(r?.n) > 0;
}

// Escribe una tabla por lotes en el ZIP (JSON + CSV) sin cargarla entera en memoria
async function _addTable(zip, table, whereSql, params, redacted) {
  let offset = 0, total = 0, header = null;
  const json = [], csv = [];
  for (;;) {
    let rows = await q(`SELECT * FROM \`${table}\` /* tenant_id: exportación de la empresa */ WHERE ${whereSql} LIMIT ${BATCH} OFFSET ${offset}`, params);
    if (!rows.length) break;
    rows = _sanitize(rows, redacted, table);
    if (!header) { header = Object.keys(rows[0]); csv.push(header.join(',')); }
    for (const r of rows) { json.push(r); csv.push(header.map(h => _csvCell(r[h])).join(',')); }
    total += rows.length; offset += rows.length;
    if (rows.length < BATCH) break;
  }
  zip.append(JSON.stringify(json, null, 1), { name: `data/${table}.json` });
  zip.append('﻿' + csv.join('\r\n'), { name: `data/${table}.csv` });  // BOM: Excel lee bien tildes/ñ
  return total;
}

/**
 * Genera el ZIP y lo escribe en `output` (stream: respuesta HTTP o archivo).
 * @returns {Promise<object>} manifest
 */
async function exportTenant(tid, output, { includeFiles = false, requestedBy = null } = {}) {
  tid = Number(tid);
  const [tenant] = await q('SELECT id, slug, name, domain, plan, created_at FROM tenants WHERE id = ?', [tid]);
  if (!tenant) throw Object.assign(new Error('Empresa no encontrada'), { status: 404 });

  const zip = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((resolve, reject) => { output.on('close', resolve); output.on('finish', resolve); zip.on('error', reject); });
  zip.pipe(output);

  const own = tid === 1 ? 'COALESCE(tenant_id, 1) = ?' : 'tenant_id = ?';
  const counts = {}, redacted = new Set(), excluded = {};

  for (const t of await _tablesWithTenant()) {
    if (EXCLUDED[t]) { excluded[t] = EXCLUDED[t]; continue; }
    counts[t] = await _addTable(zip, t, own, [tid], redacted);
  }

  // Tablas hijas por clave de sus padres
  const keys = { ticketKeys: [], workflowTemplateIds: [] };
  for (const [t, col] of [['jira_tickets', 'ticket_key'], ['jira_requirements', 'req_key']]) {
    if (await _tableExists(t)) keys.ticketKeys.push(...(await q(`SELECT ${col} AS k FROM ${t} /* tenant_id: exportación */ WHERE ${own}`, [tid])).map(r => r.k));
  }
  if (await _tableExists('workflow_templates')) {
    keys.workflowTemplateIds = (await q(`SELECT id AS k FROM workflow_templates /* tenant_id: exportación */ WHERE ${own}`, [tid])).map(r => r.k);
  }
  for (const [t, col, src] of CHILDREN) {
    if (!(await _tableExists(t))) continue;
    const list = keys[src];
    let n = 0;
    if (list.length) {
      // Por bloques para no armar una sentencia gigante
      const json = [], csv = [];
      let header = null;
      for (let i = 0; i < list.length; i += 1000) {
        const chunk = list.slice(i, i + 1000);
        let rows = await q(`SELECT * FROM \`${t}\` /* tenant_id: hijos de tickets de la empresa */ WHERE \`${col}\` IN (${chunk.map(() => '?').join(',')})`, chunk);
        rows = _sanitize(rows, redacted, t);
        if (rows.length && !header) { header = Object.keys(rows[0]); csv.push(header.join(',')); }
        for (const r of rows) { json.push(r); csv.push(header.map(h => _csvCell(r[h])).join(',')); }
        n += rows.length;
      }
      zip.append(JSON.stringify(json, null, 1), { name: `data/${t}.json` });
      zip.append('﻿' + csv.join('\r\n'), { name: `data/${t}.csv` });
    }
    counts[t] = n;
  }

  // Adjuntos locales (TK-/RQ-): uploads/tickets/<clave>/
  let files = 0;
  if (includeFiles) {
    for (const k of keys.ticketKeys) {
      const dir = path.join(UPLOADS_DIR, String(k).replace(/[^A-Za-z0-9_-]/g, '_'));
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isFile()) { zip.file(full, { name: `archivos/${path.basename(dir)}/${f}` }); files++; }
      }
    }
  }

  const manifest = {
    empresa: { id: tenant.id, nombre: tenant.name, slug: tenant.slug, dominio: tenant.domain, plan: tenant.plan },
    generado: new Date().toISOString(),
    solicitado_por: requestedBy,
    filas_por_tabla: counts,
    total_filas: Object.values(counts).reduce((a, b) => a + b, 0),
    archivos_adjuntos: includeFiles ? files : 'no incluidos (usar ?archivos=1)',
    tablas_excluidas: excluded,
    columnas_omitidas: [...redacted].sort(),
    notas: [
      'Los adjuntos de tickets de Jira están en Jira y se descargan desde allí.',
      'Los archivos CSV usan coma como separador y UTF-8; se abren con Excel.',
    ],
  };
  zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  zip.append([
    `Exportación de datos — ${tenant.name}`,
    `Generada: ${manifest.generado}`,
    '',
    'data/      Una tabla por archivo, en JSON (completo) y CSV (para Excel).',
    'archivos/  Adjuntos de los tickets locales (si se pidieron).',
    'manifest.json  Cantidad de filas por tabla, tablas excluidas y columnas omitidas.',
    '',
    'Por seguridad no se incluyen contraseñas, tokens ni sesiones.',
  ].join('\r\n'), { name: 'LEEME.txt' });

  await zip.finalize();
  await done;

  await q('INSERT INTO tenant_audit_log (tenant_id, event, actor_id, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
    [tid, 'data_export', requestedBy?.id ?? null, JSON.stringify({ filas: manifest.total_filas, archivos: files, por: requestedBy?.email || null })])
    .catch(() => {});
  return manifest;
}

module.exports = { exportTenant, EXCLUDED, SECRET_COL };

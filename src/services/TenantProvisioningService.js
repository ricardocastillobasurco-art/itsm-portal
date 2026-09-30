'use strict';

// Copia la ESTRUCTURA base (configuración, nunca datos de negocio) del tenant
// plantilla a un tenant nuevo: políticas SLA, categorías, catálogo de servicios,
// automatizaciones (sin correos y desactivadas), etc. Solo llena tablas que el
// tenant destino aún tiene vacías, así que se puede ejecutar varias veces.

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');

const TEMPLATE_TENANT_ID = 1;
const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

async function tableExists(table) {
  const [r] = await q('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]);
  return Number(r.n) > 0;
}

async function isEmptyFor(table, tid) {
  const [r] = await q(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE tenant_id = ?`, [tid]);
  return Number(r.n) === 0;
}

async function insertRow(table, row) {
  const keys = Object.keys(row);
  return q(`INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    keys.map(k => row[k]));
}

async function templateRows(table, extraWhere = '') {
  return q(`SELECT * FROM \`${table}\` WHERE COALESCE(tenant_id, 1) = ? ${extraWhere} ORDER BY 1`, [TEMPLATE_TENANT_ID]);
}

// Tablas con PK autoincremental y sin dependencias. transform(row) puede ajustar valores.
async function copyFlat(table, tid, transform = (r) => r) {
  if (!(await tableExists(table)) || !(await isEmptyFor(table, tid))) return 0;
  let n = 0;
  for (const { id, ...rest } of await templateRows(table)) {
    await insertRow(table, transform({ ...rest, tenant_id: tid }));
    n++;
  }
  return n;
}

// Tablas con PK UUID; devuelve el mapa idViejo → idNuevo. remap: { columna: Map } para FKs.
async function copyUuid(table, tid, { remap = {}, extraWhere = '' } = {}) {
  const map = new Map();
  if (!(await tableExists(table)) || !(await isEmptyFor(table, tid))) return map;
  for (const r of await templateRows(table, extraWhere)) {
    const row = { ...r, id: crypto.randomUUID(), tenant_id: tid };
    for (const [col, m] of Object.entries(remap)) if (row[col] != null) row[col] = m.get(row[col]) ?? null;
    await insertRow(table, row);
    map.set(r.id, row.id);
  }
  return map;
}

// Árbol con parent_id autoincremental: inserta padres antes que hijos y remapea.
async function copyTree(table, tid) {
  if (!(await tableExists(table)) || !(await isEmptyFor(table, tid))) return 0;
  const map = new Map();
  let pending = await templateRows(table), n = 0;
  while (pending.length) {
    const next = [];
    for (const r of pending) {
      if (r.parent_id != null && !map.has(r.parent_id)) { next.push(r); continue; }
      const { id, ...rest } = r;
      const res = await insertRow(table, { ...rest, tenant_id: tid, parent_id: r.parent_id == null ? null : map.get(r.parent_id) });
      map.set(id, res.insertId);
      n++;
    }
    if (next.length === pending.length) break; // padres fuera de la plantilla: se omiten
    pending = next;
  }
  return n;
}

async function copyBaseStructure(tenantId) {
  const tid = Number(tenantId);
  if (!tid || tid === TEMPLATE_TENANT_ID) throw new Error('Tenant destino inválido');

  const summary = {};
  summary.sla_policies     = await copyFlat('sla_policies', tid);
  summary.itsm_categories  = await copyFlat('itsm_categories', tid);
  summary.derive_teams     = await copyFlat('derive_teams', tid);
  summary.software_catalog = await copyFlat('software_catalog', tid);
  summary.catalog_software = await copyFlat('catalog_software', tid);
  // Automatizaciones: mismas claves, pero sin correos del dueño y desactivadas
  summary.itsm_automations = await copyFlat('itsm_automations', tid, (r) => ({
    ...r,
    value: /email/i.test(r.key) ? '' : /enabled$/i.test(r.key) ? '0' : r.value,
  }));
  summary.kb_categories      = (await copyUuid('kb_categories', tid)).size;
  const cats                 = await copyUuid('service_categories', tid);
  summary.service_categories = cats.size;
  summary.services           = (await copyUuid('services', tid, { remap: { category_id: cats }, extraWhere: 'AND deleted_at IS NULL' })).size;
  summary.ticket_categories  = await copyTree('ticket_categories', tid);
  return summary;
}

module.exports = { copyBaseStructure, TEMPLATE_TENANT_ID };

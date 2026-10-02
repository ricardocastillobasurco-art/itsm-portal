'use strict';

// Catálogos de cierre por empresa: tipo de resolución, proceso impactado y
// resultado (padre → detalle). Cada empresa los edita en Administración.
// Mientras una empresa no guarde los suyos, recibe la lista genérica.
//
// Tabla ticket_catalog_options (migración 20261002000001) y dos claves en
// itsm_automations: close_catalogs_configured y close_ask_masiva.

const { executeQuery, equipmentPool } = require('../../config/database');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

const CATALOGS  = ['resolucion', 'proceso', 'resultado'];
const MAX_ITEMS = 100;
const MAX_LEN   = 150;

const GENERIC = Object.freeze({
  resolucion: ['Resuelto', 'Solución temporal (workaround)', 'Orientación al usuario', 'Reinicio de servicio',
               'Sin acción requerida', 'Ticket duplicado', 'Cancelado por el usuario'],
  proceso:    [],
  resultado:  [
    { value: 'Hardware',          children: ['Falla de equipo', 'Periférico', 'Reemplazo'] },
    { value: 'Software',          children: ['Error de aplicación', 'Configuración', 'Actualización'] },
    { value: 'Red',               children: ['Conectividad', 'VPN', 'Wi-Fi'] },
    { value: 'Accesos',           children: ['Contraseña', 'Permisos', 'Cuenta bloqueada'] },
    { value: 'Usuario',           children: ['Capacitación', 'Error operativo'] },
    { value: 'Proveedor externo', children: ['Proveedor externo'] },
  ],
  ask_masiva: false,
});

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
function uniqueList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(clean).filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .slice(0, MAX_ITEMS);
}

async function flags(tid) {
  const rows = await q(`SELECT \`key\`, value FROM itsm_automations
                        WHERE COALESCE(tenant_id, 1) = ? AND \`key\` IN ('close_catalogs_configured', 'close_ask_masiva')`, [tid]);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function setFlag(tid, key, value) {
  await q(`INSERT INTO itsm_automations (tenant_id, \`key\`, value) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`, [tid, key, value]);
}

// { resolucion: [..], proceso: [..], resultado: [{ value, children: [..] }], ask_masiva, configured }
async function getCatalogs(tid) {
  tid = Number(tid) || 1;
  const f = await flags(tid);
  if (f.close_catalogs_configured !== '1') return { ...GENERIC, configured: false };

  const rows = await q(`SELECT catalog_key, value, parent_value FROM ticket_catalog_options
                        WHERE tenant_id = ? ORDER BY catalog_key, sort_order, id`, [tid]);
  const out = { resolucion: [], proceso: [], resultado: [], ask_masiva: f.close_ask_masiva === '1', configured: true };
  const parents = new Map();
  for (const r of rows) {
    if (r.catalog_key === 'resultado') {
      if (!r.parent_value) {
        const node = { value: r.value, children: [] };
        parents.set(r.value, node);
        out.resultado.push(node);
      }
    } else if (out[r.catalog_key]) out[r.catalog_key].push(r.value);
  }
  for (const r of rows) {
    if (r.catalog_key === 'resultado' && r.parent_value && parents.has(r.parent_value)) parents.get(r.parent_value).children.push(r.value);
  }
  return out;
}

// Reemplaza todos los catálogos de la empresa (lo que no venga queda vacío)
async function saveCatalogs(tid, input = {}) {
  tid = Number(tid) || 1;
  const data = {
    resolucion: uniqueList(input.resolucion),
    proceso:    uniqueList(input.proceso),
    resultado:  [],
  };
  const seen = new Set();
  for (const p of (Array.isArray(input.resultado) ? input.resultado : [])) {
    const value = clean(p?.value ?? p);
    if (!value || seen.has(value.toLowerCase()) || data.resultado.length >= MAX_ITEMS) continue;
    seen.add(value.toLowerCase());
    data.resultado.push({ value, children: uniqueList(p?.children) });
  }
  if (!data.resolucion.length) {
    throw Object.assign(new Error('Debe haber al menos un tipo de resolución'), { status: 400 });
  }

  const rows = [];
  data.resolucion.forEach((v, i) => rows.push(['resolucion', v, '', i]));
  data.proceso.forEach((v, i) => rows.push(['proceso', v, '', i]));
  data.resultado.forEach((p, i) => {
    rows.push(['resultado', p.value, '', i]);
    p.children.forEach((c, j) => rows.push(['resultado', c, p.value, j]));
  });

  await q('DELETE FROM ticket_catalog_options WHERE tenant_id = ?', [tid]);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await q(`INSERT INTO ticket_catalog_options (tenant_id, catalog_key, value, parent_value, sort_order)
             VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}`, chunk.flatMap(r => [tid, ...r]));
  }
  await setFlag(tid, 'close_ask_masiva', input.ask_masiva ? '1' : '0');
  await setFlag(tid, 'close_catalogs_configured', '1');
  return getCatalogs(tid);
}

// Vuelve a la lista genérica (borra la personalización)
async function resetCatalogs(tid) {
  tid = Number(tid) || 1;
  await q('DELETE FROM ticket_catalog_options WHERE tenant_id = ?', [tid]);
  await q(`DELETE FROM itsm_automations WHERE tenant_id = ? AND \`key\` IN ('close_catalogs_configured', 'close_ask_masiva')`, [tid]);
  return getCatalogs(tid);
}

module.exports = { getCatalogs, saveCatalogs, resetCatalogs, GENERIC, CATALOGS };

'use strict';

// Filtros SQL por tenant para consultas escritas a mano. Siempre filtran: el
// tenant sale de la sesión (src/utils/tenantScope). Filas con tenant_id NULL
// (datos legacy, tickets sincronizados desde Jira) pertenecen al tenant 1.

const { tenantId } = require('../src/utils/tenantScope');

function getTenantId(req) {
  return tenantId(req);
}

/**
 * Fragmento SQL para filtrar por tenant.
 * Uso: `WHERE active = 1 ${tenantWhere(req, 'jt')}` → ` AND COALESCE(jt.tenant_id, 1) = 2`
 */
function tenantWhere(req, alias = '') {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return ` AND COALESCE(${col}, 1) = ${Number(tenantId(req))}`;
}

/**
 * Para queries parametrizadas: devuelve [sqlFragment, params]
 * Uso: const [tw, tp] = tenantParam(req); query(`WHERE x=? ${tw}`, [..., ...tp])
 */
function tenantParam(req, alias = '') {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return [` AND COALESCE(${col}, 1) = ?`, [tenantId(req)]];
}

module.exports = { getTenantId, tenantWhere, tenantParam };

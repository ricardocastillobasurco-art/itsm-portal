'use strict';

/**
 * Devuelve el tenant_id del usuario autenticado.
 * Si el usuario no tiene tenant (superadmin), devuelve null → sin filtro.
 */
function getTenantId(req) {
  return req.user?.tenant_id || req.tenant?.id || null;
}

/**
 * Devuelve un fragmento SQL seguro para filtrar por tenant.
 * Uso: `WHERE active = 1 ${tenantWhere(req, 'jt')}` → `AND jt.tenant_id = 2`
 *
 * @param {object} req   - Express request con req.user.tenant_id
 * @param {string} alias - Alias de tabla (opcional), ej: 'jt'
 * @returns {string}     - ' AND alias.tenant_id = N' o '' si superadmin
 */
function tenantWhere(req, alias = '') {
  const tid = getTenantId(req);
  if (!tid) return '';
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return ` AND ${col} = ${parseInt(tid)}`;
}

/**
 * Para queries parametrizadas: devuelve [sqlFragment, params]
 * Uso: const [tw, tp] = tenantParam(req); query(`WHERE x=? ${tw}`, [..., ...tp])
 */
function tenantParam(req, alias = '') {
  const tid = getTenantId(req);
  if (!tid) return ['', []];
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return [` AND ${col} = ?`, [parseInt(tid)]];
}

module.exports = { getTenantId, tenantWhere, tenantParam };

'use strict';

const { ForbiddenError } = require('../../utils/errors');

const ADMIN_ROLES        = ['administrador', 'admin'];
const STAFF_ROLES        = ['administrador', 'especialista', 'agente', 'admin', 'supervisor'];
const MANAGEMENT_ROLES   = ['administrador', 'especialista', 'admin', 'supervisor'];

class BasePolicy {
  /**
   * Verifica que el recurso pertenece al tenant del request.
   * Es la última línea de defensa contra fugas cross-tenant.
   */
  static _sameTenant(resource, req) {
    const resourceTenantId = resource?.tenantId ?? resource?.tenant_id;
    if (resourceTenantId == null) return true;  // sin tenant_id → recurso global
    return String(resourceTenantId) === String(req.tenant?.id);
  }

  static _throw(msg = 'Acceso denegado') {
    throw new ForbiddenError(msg);
  }

  static _assert(condition, msg) {
    if (!condition) this._throw(msg);
  }

  static _role(req) {
    return req.user?.role || '';
  }

  static _isAdmin(req)       { return ADMIN_ROLES.includes(this._role(req)); }
  static _isManagement(req)  { return MANAGEMENT_ROLES.includes(this._role(req)); }
  static _isStaff(req)       { return STAFF_ROLES.includes(this._role(req)); }
  static _isOwner(resource, req) {
    const uid = req.user?.id;
    return uid && (resource?.createdBy === uid || resource?.requesterId === uid || resource?.assignedTo === uid);
  }
}

module.exports = { BasePolicy, ADMIN_ROLES, STAFF_ROLES, MANAGEMENT_ROLES };

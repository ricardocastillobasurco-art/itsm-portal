'use strict';

const { BasePolicy, MANAGEMENT_ROLES } = require('./BasePolicy');

class ChangePolicy extends BasePolicy {
  static assertRead(req, change) {
    this._assert(this._sameTenant(change, req), 'Cambio no pertenece a tu organización');
  }

  static assertCreate(req) {
    this._assert(this._isManagement(req), 'Solo especialistas o administradores pueden crear cambios');
  }

  static assertUpdate(req, change) {
    this._assert(this._sameTenant(change, req), 'Cambio no pertenece a tu organización');

    const lockedStatuses = ['aprobado', 'en_implementacion', 'implementado', 'revisado'];
    if (lockedStatuses.includes(change.status)) {
      this._assert(this._isAdmin(req), 'Solo administradores pueden modificar cambios en estado avanzado');
    }
  }

  static assertApprove(req, change) {
    this._assert(this._sameTenant(change, req), 'Cambio no pertenece a tu organización');
    this._assert(
      change.status === 'pendiente_aprobacion',
      'Solo se pueden aprobar cambios en estado "pendiente_aprobacion"'
    );
    this._assert(this._isManagement(req), 'Solo especialistas o administradores pueden aprobar cambios');
    // El creador no puede aprobar su propio cambio
    this._assert(
      change.requestedBy !== req.user?.id,
      'No puedes aprobar un cambio que tú mismo creaste'
    );
  }

  static assertSubmitForApproval(req, change) {
    this._assert(this._sameTenant(change, req), 'Cambio no pertenece a tu organización');
    this._assert(change.status === 'borrador', 'Solo cambios en borrador pueden enviarse a aprobación');
    // El creador o un admin puede enviarlo
    const canSubmit = this._isOwner(change, req) || this._isAdmin(req);
    this._assert(canSubmit, 'No puedes enviar este cambio a aprobación');
  }

  static assertDelete(req, change) {
    this._assert(this._sameTenant(change, req), 'Cambio no pertenece a tu organización');
    this._assert(this._isAdmin(req), 'Solo administradores pueden eliminar cambios');
    this._assert(
      ['borrador', 'cancelado'].includes(change.status),
      'Solo cambios en borrador o cancelados pueden eliminarse'
    );
  }
}

module.exports = ChangePolicy;

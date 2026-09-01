'use strict';

const { BasePolicy } = require('./BasePolicy');

class AssetPolicy extends BasePolicy {
  static assertRead(req, ci) {
    this._assert(this._sameTenant(ci, req), 'CI no pertenece a tu organización');
  }

  static assertCreate(req) {
    this._assert(this._isStaff(req), 'Solo el personal de TI puede crear CIs');
  }

  static assertUpdate(req, ci) {
    this._assert(this._sameTenant(ci, req), 'CI no pertenece a tu organización');
    this._assert(this._isStaff(req), 'Solo el personal de TI puede modificar CIs');

    // CIs retirados solo los puede modificar un admin
    if (ci.status === 'retirado') {
      this._assert(this._isAdmin(req), 'Solo administradores pueden modificar CIs retirados');
    }
  }

  static assertDelete(req, ci) {
    this._assert(this._sameTenant(ci, req), 'CI no pertenece a tu organización');
    this._assert(this._isAdmin(req), 'Solo administradores pueden eliminar CIs');
  }

  static assertManageRelationship(req, ci) {
    this._assert(this._sameTenant(ci, req), 'CI no pertenece a tu organización');
    this._assert(this._isManagement(req), 'Solo especialistas o administradores pueden gestionar relaciones entre CIs');
  }
}

module.exports = AssetPolicy;

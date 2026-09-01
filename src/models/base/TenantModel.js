'use strict';

const { Model } = require('sequelize');

/**
 * Base model that enforces tenant isolation at the ORM level.
 *
 * Usage — in any Sequelize model file:
 *   const TenantModel = require('./base/TenantModel');
 *   class Ticket extends TenantModel { ... }
 *   TenantModel.initWithTenant(Ticket, { ... fields ... }, { sequelize, tableName: 'tickets' });
 *
 * What it does automatically:
 *   beforeCreate  → copies req.tenantId (set by tenantScope middleware) onto the record
 *   defaultScope  → does NOT auto-filter (Sequelize defaultScopes break associations);
 *                   use tenantWhere(req) in your repository instead
 */
class TenantModel extends Model {
  /**
   * Drop-in replacement for Model.init() that:
   *  - Adds tenant_id to the model definition
   *  - Registers the beforeCreate hook
   */
  static initWithTenant(fields, options) {
    const { DataTypes } = require('sequelize');

    const tenantField = {
      tenantId: {
        type:         DataTypes.INTEGER.UNSIGNED,
        allowNull:    true,
        defaultValue: null,
        field:        'tenant_id',
      },
    };

    super.init({ ...tenantField, ...fields }, options);

    // Hook: auto-assign tenant_id from the _tenantId property injected by the service layer
    this.addHook('beforeCreate', (instance) => {
      if (instance._tenantId && !instance.tenantId) {
        instance.tenantId = instance._tenantId;
      }
    });

    return this;
  }
}

module.exports = TenantModel;

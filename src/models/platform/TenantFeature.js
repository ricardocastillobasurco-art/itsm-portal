'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const TenantFeature = sequelize.define('TenantFeature', {
  id: {
    type:          DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey:    true,
  },
  tenantId: {
    type:      DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    field:     'tenant_id',
  },
  name: {
    type:      DataTypes.STRING(100),
    allowNull: false,
  },
  enabled: {
    type:         DataTypes.BOOLEAN,
    allowNull:    false,
    defaultValue: false,
  },
  config: {
    type:         DataTypes.JSON,
    allowNull:    true,
    defaultValue: null,
  },
}, {
  tableName:   'tenant_features',
  underscored: true,
  timestamps:  true,
});

module.exports = TenantFeature;

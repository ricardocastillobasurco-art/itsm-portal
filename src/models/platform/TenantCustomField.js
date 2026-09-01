'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const TenantCustomField = sequelize.define('TenantCustomField', {
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
  entityType: {
    type:      DataTypes.STRING(50),
    allowNull: false,
    field:     'entity_type',
  },
  fieldKey: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    field:     'field_key',
  },
  fieldLabel: {
    type:      DataTypes.STRING(150),
    allowNull: false,
    field:     'field_label',
  },
  fieldType: {
    type:         DataTypes.ENUM('text', 'number', 'date', 'select', 'checkbox', 'textarea'),
    allowNull:    false,
    defaultValue: 'text',
    field:        'field_type',
  },
  fieldOptions: {
    type:         DataTypes.JSON,
    allowNull:    true,
    defaultValue: null,
    field:        'field_options',
  },
  required: {
    type:         DataTypes.BOOLEAN,
    allowNull:    false,
    defaultValue: false,
  },
  sortOrder: {
    type:         DataTypes.INTEGER,
    allowNull:    false,
    defaultValue: 0,
    field:        'sort_order',
  },
  isActive: {
    type:         DataTypes.BOOLEAN,
    allowNull:    false,
    defaultValue: true,
    field:        'is_active',
  },
}, {
  tableName:   'tenant_custom_fields',
  underscored: true,
  timestamps:  true,
});

module.exports = TenantCustomField;

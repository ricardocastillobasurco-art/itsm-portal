'use strict';

const { DataTypes } = require('sequelize');
const sequelize     = require('../../config/database');

const Tenant = sequelize.define('Tenant', {
  id: {
    type:          DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey:    true,
  },
  slug: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    unique:    true,
    validate:  { is: /^[a-z0-9-]+$/ },
  },
  name: {
    type:      DataTypes.STRING(255),
    allowNull: false,
  },
  plan: {
    type:         DataTypes.ENUM('trial', 'starter', 'professional', 'enterprise'),
    allowNull:    false,
    defaultValue: 'enterprise',
  },
  domain: {
    type:      DataTypes.STRING(100),
    allowNull: true,
    field:     'domain',
  },
  contactEmail: {
    type:      DataTypes.STRING(255),
    allowNull: true,
    field:     'contact_email',
  },
  settings: {
    type:         DataTypes.JSON,
    allowNull:    true,
    defaultValue: null,
  },
  isActive: {
    type:         DataTypes.BOOLEAN,
    allowNull:    false,
    defaultValue: true,
    field:        'is_active',
  },
}, {
  tableName:   'tenants',
  timestamps:  true,
  underscored: true,
});

module.exports = Tenant;

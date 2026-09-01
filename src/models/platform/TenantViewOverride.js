'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const TenantViewOverride = sequelize.define('TenantViewOverride', {
  id: {
    type:          DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey:    true,
  },
  tenantId: {
    type:      DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    unique:    true,
    field:     'tenant_id',
  },
  companyName:    { type: DataTypes.STRING(255), allowNull: true, field: 'company_name' },
  logoUrl:        { type: DataTypes.STRING(500), allowNull: true, field: 'logo_url' },
  faviconUrl:     { type: DataTypes.STRING(500), allowNull: true, field: 'favicon_url' },
  primaryColor:   { type: DataTypes.STRING(7),   allowNull: true, field: 'primary_color' },
  secondaryColor: { type: DataTypes.STRING(7),   allowNull: true, field: 'secondary_color' },
  customCss:      { type: DataTypes.TEXT,        allowNull: true, field: 'custom_css' },
}, {
  tableName:   'tenant_view_overrides',
  underscored: true,
  timestamps:  true,
});

module.exports = TenantViewOverride;

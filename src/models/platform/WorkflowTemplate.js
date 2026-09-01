'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const WorkflowTemplate = sequelize.define('WorkflowTemplate', {
  id:         { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  tenantId:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false,  field: 'tenant_id' },
  entityType: { type: DataTypes.ENUM('service_request', 'change'), allowNull: false, field: 'entity_type' },
  name:       { type: DataTypes.STRING(100), allowNull: false },
  description:{ type: DataTypes.TEXT,        allowNull: true },
  isActive:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
}, {
  tableName:   'workflow_templates',
  underscored: true,
  timestamps:  true,
});

module.exports = WorkflowTemplate;

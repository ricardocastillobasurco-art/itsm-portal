'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const WorkflowInstance = sequelize.define('WorkflowInstance', {
  id:          { type: DataTypes.CHAR(36), primaryKey: true },
  templateId:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'template_id' },
  entityType:  { type: DataTypes.STRING(50), allowNull: false, field: 'entity_type' },
  entityId:    { type: DataTypes.CHAR(36),   allowNull: false, field: 'entity_id' },
  tenantId:    { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'tenant_id' },
  currentStep: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'current_step' },
  status: {
    type:         DataTypes.ENUM('en_curso', 'aprobado', 'rechazado', 'cancelado'),
    allowNull:    false,
    defaultValue: 'en_curso',
  },
  resolvedAt:  { type: DataTypes.DATE, allowNull: true, defaultValue: null, field: 'resolved_at' },
  resolvedBy:  { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null, field: 'resolved_by' },
}, {
  tableName:   'workflow_instances',
  underscored: true,
  timestamps:  true,
});

module.exports = WorkflowInstance;

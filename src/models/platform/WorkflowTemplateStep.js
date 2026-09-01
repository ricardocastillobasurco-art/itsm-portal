'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const WorkflowTemplateStep = sequelize.define('WorkflowTemplateStep', {
  id:               { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  templateId:       { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'template_id' },
  stepOrder:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'step_order' },
  stepName:         { type: DataTypes.STRING(100), allowNull: false, field: 'step_name' },
  approverRole:     { type: DataTypes.STRING(50),  allowNull: true, field: 'approver_role' },
  approverUserId:   { type: DataTypes.CHAR(36),    allowNull: true, field: 'approver_user_id' },
  autoApproveHours: { type: DataTypes.INTEGER,     allowNull: true, defaultValue: null, field: 'auto_approve_hours' },
}, {
  tableName:   'workflow_template_steps',
  underscored: true,
  timestamps:  true,
});

module.exports = WorkflowTemplateStep;

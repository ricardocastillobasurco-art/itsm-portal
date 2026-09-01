const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ApprovalFlow = sequelize.define('ApprovalFlow', {
    id:                 { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    workflowInstanceId: { type: DataTypes.CHAR(36),           allowNull: true,  defaultValue: null, field: 'workflow_instance_id' },
    stepId:             { type: DataTypes.INTEGER.UNSIGNED,   allowNull: true,  defaultValue: null, field: 'step_id' },
    serviceRequestId:   { type: DataTypes.CHAR(36),           allowNull: false, field: 'service_request_id' },
    approverId:         { type: DataTypes.CHAR(36),           allowNull: false, field: 'approver_id' },
    stepOrder:          { type: DataTypes.INTEGER,            defaultValue: 1,  field: 'step_order' },
    status:             { type: DataTypes.ENUM('pendiente','aprobado','rechazado'), defaultValue: 'pendiente' },
    comments:           { type: DataTypes.TEXT, allowNull: true },
    decidedAt:          { type: DataTypes.DATE, allowNull: true, field: 'decided_at' },
}, {
    tableName:   'approval_flows',
    underscored: true,
    paranoid:    false,
    timestamps:  true,
    updatedAt:   'updated_at',
    createdAt:   'created_at',
});

module.exports = ApprovalFlow;

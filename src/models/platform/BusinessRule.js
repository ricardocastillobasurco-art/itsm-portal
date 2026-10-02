const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// MariaDB guarda JSON como texto y lo devuelve como string; MySQL 8 como objeto
const _json = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return v; } };

const BusinessRule = sequelize.define('BusinessRule', {
    id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenantId:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    name:        { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    conditions:  { type: DataTypes.JSON, allowNull: false, comment: 'json-rules-engine conditions object', get() { return _json(this.getDataValue('conditions')); } },
    actions:     { type: DataTypes.JSON, allowNull: false, comment: 'array of {type, params}', get() { return _json(this.getDataValue('actions')); } },
    isActive:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    priority:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10, comment: 'lower = evaluated first' },
    runOn:       {
        type:         DataTypes.ENUM('ticket_created', 'ticket_updated', 'sla_check'),
        allowNull:    false,
        defaultValue: 'ticket_created',
    },
    createdBy:   { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
}, {
    tableName:   'business_rules',
    timestamps:  true,
    underscored: true,
});

module.exports = BusinessRule;

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ServiceCategory = sequelize.define('ServiceCategory', {
    id:          { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    name:        { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT,        allowNull: true  },
    icon:        { type: DataTypes.STRING(50),  allowNull: true  },
    isActive:    { type: DataTypes.BOOLEAN,     defaultValue: true, field: 'is_active' },
}, {
    tableName:   'service_categories',
    underscored: true,
    paranoid:    false,
    timestamps:  true,
});

module.exports = ServiceCategory;

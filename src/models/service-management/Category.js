const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Category = sequelize.define('Category', {
    id:     { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    nombre: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    area:   { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'itsm_categories', timestamps: true, underscored: true });

module.exports = Category;

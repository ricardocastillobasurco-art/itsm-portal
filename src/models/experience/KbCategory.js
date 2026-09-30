const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const KbCategory = sequelize.define('KbCategory', {
    id:          { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    name:        { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT,        allowNull: true  },
    icon:        { type: DataTypes.STRING(50),  defaultValue: 'book' },
    sortOrder:   { type: DataTypes.INTEGER,     defaultValue: 0,     field: 'sort_order' },
}, {
    tableName:   'kb_categories',
    underscored: true,
    paranoid:    false,
    timestamps:  true,
});

module.exports = KbCategory;

const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const UserToolHistory = sequelize.define('UserToolHistory', {
    id:      { type: DataTypes.INTEGER,      primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING(36),   allowNull: false },
    tool:    { type: DataTypes.STRING(50),   allowNull: false },
    data:    { type: DataTypes.JSON,         allowNull: false, defaultValue: {} },
    label:   { type: DataTypes.STRING(120),  allowNull: true },
}, {
    tableName:   'user_tool_history',
    timestamps:  true,
    underscored: true,
    updatedAt:   false,
    indexes: [
        { fields: ['user_id', 'tool'] },
        { fields: ['created_at'] },
    ],
});

module.exports = UserToolHistory;

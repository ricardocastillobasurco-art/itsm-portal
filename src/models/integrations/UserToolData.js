const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const UserToolData = sequelize.define('UserToolData', {
    id:      { type: DataTypes.INTEGER,      primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING(36),   allowNull: false },
    tool:    { type: DataTypes.STRING(50),   allowNull: false },
    data:    { type: DataTypes.JSON,         allowNull: false, defaultValue: {} },
}, {
    tableName:  'user_tool_data',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'tool'] }],
});

module.exports = UserToolData;

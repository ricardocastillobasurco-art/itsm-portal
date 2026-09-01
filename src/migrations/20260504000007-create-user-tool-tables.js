'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
    async up(queryInterface) {
        const tables = await queryInterface.showAllTables();
        const addIdxSafe = async (table, cols, opts) => {
            try { await queryInterface.addIndex(table, cols, opts); }
            catch (e) { if (!e.message.includes('Duplicate key name')) throw e; }
        };

        if (!tables.includes('user_tool_data')) {
            await queryInterface.createTable('user_tool_data', {
                id: {
                    type:          DataTypes.INTEGER,
                    primaryKey:    true,
                    autoIncrement: true,
                },
                user_id: {
                    type:      DataTypes.STRING(36),
                    allowNull: false,
                },
                tool: {
                    type:      DataTypes.STRING(50),
                    allowNull: false,
                },
                data: {
                    type:         DataTypes.JSON,
                    allowNull:    false,
                    defaultValue: {},
                },
                created_at: {
                    type:         DataTypes.DATE,
                    allowNull:    false,
                    defaultValue: DataTypes.NOW,
                },
                updated_at: {
                    type:         DataTypes.DATE,
                    allowNull:    false,
                    defaultValue: DataTypes.NOW,
                },
            });
            await addIdxSafe('user_tool_data', ['user_id', 'tool'], { unique: true, name: 'uk_utd_user_tool' });
            await addIdxSafe('user_tool_data', ['user_id'],          { name: 'idx_utd_user' });
        }

        if (!tables.includes('user_tool_history')) {
            await queryInterface.createTable('user_tool_history', {
                id: {
                    type:          DataTypes.INTEGER,
                    primaryKey:    true,
                    autoIncrement: true,
                },
                user_id: {
                    type:      DataTypes.STRING(36),
                    allowNull: false,
                },
                tool: {
                    type:      DataTypes.STRING(50),
                    allowNull: false,
                },
                data: {
                    type:         DataTypes.JSON,
                    allowNull:    false,
                    defaultValue: {},
                },
                label: {
                    type:      DataTypes.STRING(120),
                    allowNull: true,
                },
                created_at: {
                    type:         DataTypes.DATE,
                    allowNull:    false,
                    defaultValue: DataTypes.NOW,
                },
            });
            await addIdxSafe('user_tool_history', ['user_id', 'tool'], { name: 'idx_uth_user_tool' });
            await addIdxSafe('user_tool_history', ['created_at'],       { name: 'idx_uth_created' });
        }
    },

    async down(queryInterface) {
        await queryInterface.dropTable('user_tool_history');
        await queryInterface.dropTable('user_tool_data');
    },
};

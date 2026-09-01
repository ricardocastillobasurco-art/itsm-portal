// ============================================================================
// Migración 004 — Tabla: audit_logs
// ============================================================================

'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
    async up(queryInterface) {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes('audit_logs')) {
            await queryInterface.createTable('audit_logs', {
                id: {
                    type:          DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey:    true,
                },
                user_id: {
                    type:      DataTypes.CHAR(36),
                    allowNull: true,
                },
                accion: {
                    type:      DataTypes.STRING(100),
                    allowNull: false,
                },
                recurso: {
                    type:         DataTypes.STRING(100),
                    allowNull:    true,
                    defaultValue: null,
                },
                recurso_id: {
                    type:         DataTypes.STRING(100),
                    allowNull:    true,
                    defaultValue: null,
                },
                detalles: {
                    type:         DataTypes.TEXT,
                    allowNull:    true,
                    defaultValue: null,
                },
                ip: {
                    type:         DataTypes.STRING(45),
                    allowNull:    true,
                    defaultValue: null,
                },
                user_agent: {
                    type:         DataTypes.STRING(500),
                    allowNull:    true,
                    defaultValue: null,
                },
                created_at: {
                    type:         DataTypes.DATE,
                    allowNull:    false,
                    defaultValue: DataTypes.NOW,
                },
            });
        } else {
            const cols = await queryInterface.describeTable('audit_logs').catch(() => null);
            if (cols && !cols.user_id) {
                await queryInterface.addColumn('audit_logs', 'user_id', {
                    type:      DataTypes.CHAR(36),
                    allowNull: true,
                    after:     'id',
                });
            }
        }

        const addIdxSafe = async (cols, name) => {
            try { await queryInterface.addIndex('audit_logs', cols, { name }); }
            catch (e) { if (!e.message.includes('Duplicate key name')) throw e; }
        };
        await addIdxSafe(['user_id'],    'idx_audit_user');
        await addIdxSafe(['accion'],     'idx_audit_accion');
        await addIdxSafe(['created_at'], 'idx_audit_created');
    },

    async down(queryInterface) {
        await queryInterface.dropTable('audit_logs');
    },
};

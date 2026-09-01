'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const addIdxSafe = async (table, cols, opts) => {
      try { await queryInterface.addIndex(table, cols, opts); }
      catch (e) { if (!e.message.includes('Duplicate key name')) throw e; }
    };

    if (!tables.includes('workflow_templates')) {
      await queryInterface.createTable('workflow_templates', {
        id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        tenant_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false,
                       references: { model: 'tenants', key: 'id' }, onDelete: 'CASCADE' },
        entity_type: { type: DataTypes.ENUM('service_request', 'change'), allowNull: false },
        name:        { type: DataTypes.STRING(100), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        is_active:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await addIdxSafe('workflow_templates', ['tenant_id', 'entity_type', 'is_active'],
        { name: 'idx_wt_tenant_entity_active' });
    }

    if (!tables.includes('workflow_template_steps')) {
      await queryInterface.createTable('workflow_template_steps', {
        id:                { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        template_id:       { type: DataTypes.INTEGER.UNSIGNED, allowNull: false,
                             references: { model: 'workflow_templates', key: 'id' }, onDelete: 'CASCADE' },
        step_order:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        step_name:         { type: DataTypes.STRING(100), allowNull: false },
        approver_role:     { type: DataTypes.STRING(50),  allowNull: true },
        approver_user_id:  { type: DataTypes.CHAR(36), allowNull: true },
        auto_approve_hours:{ type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
        created_at:        { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at:        { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await addIdxSafe('workflow_template_steps', ['template_id', 'step_order'],
        { name: 'idx_wts_template_order' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('workflow_template_steps');
    await queryInterface.dropTable('workflow_templates');
  },
};

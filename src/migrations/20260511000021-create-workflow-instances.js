'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('workflow_instances')) return;
    await queryInterface.createTable('workflow_instances', {
      id:           { type: DataTypes.CHAR(36), primaryKey: true },
      template_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false,
                      references: { model: 'workflow_templates', key: 'id' } },
      entity_type:  { type: DataTypes.STRING(50), allowNull: false },
      entity_id:    { type: DataTypes.CHAR(36),   allowNull: false },
      tenant_id:    { type: DataTypes.INTEGER.UNSIGNED, allowNull: false,
                      references: { model: 'tenants', key: 'id' } },
      current_step: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      status: {
        type:         DataTypes.ENUM('en_curso', 'aprobado', 'rechazado', 'cancelado'),
        allowNull:    false,
        defaultValue: 'en_curso',
      },
      resolved_at:  { type: DataTypes.DATE, allowNull: true, defaultValue: null },
      resolved_by:  { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
      created_at:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    await queryInterface.addIndex('workflow_instances', ['entity_type', 'entity_id'],
      { name: 'idx_wi_entity' });
    await queryInterface.addIndex('workflow_instances', ['tenant_id', 'status'],
      { name: 'idx_wi_tenant_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('workflow_instances');
  },
};

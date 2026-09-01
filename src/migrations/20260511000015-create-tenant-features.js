'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('tenant_features')) return;
    await queryInterface.createTable('tenant_features', {
      id: {
        type:          DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey:    true,
      },
      tenant_id: {
        type:       DataTypes.INTEGER.UNSIGNED,
        allowNull:  false,
        references: { model: 'tenants', key: 'id' },
        onDelete:   'CASCADE',
      },
      name: {
        type:      DataTypes.STRING(100),
        allowNull: false,
        comment:   'ej: jira_sync, ai_suggestions, custom_reports, sla_escalation',
      },
      enabled: {
        type:         DataTypes.BOOLEAN,
        allowNull:    false,
        defaultValue: false,
      },
      config: {
        type:         DataTypes.JSON,
        allowNull:    true,
        defaultValue: null,
        comment:      'Configuración adicional específica del feature',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    await queryInterface.addIndex('tenant_features', ['tenant_id', 'name'], {
      name:   'uq_tenant_features_tenant_name',
      unique: true,
    });
    await queryInterface.addIndex('tenant_features', ['tenant_id', 'enabled'], {
      name: 'idx_tenant_features_tenant_enabled',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_features');
  },
};

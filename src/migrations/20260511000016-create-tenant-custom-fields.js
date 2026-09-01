'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('tenant_custom_fields')) return;
    await queryInterface.createTable('tenant_custom_fields', {
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
      entity_type: {
        type:      DataTypes.STRING(50),
        allowNull: false,
        comment:   'ticket | asset | service_request | change | problem',
      },
      field_key: {
        type:      DataTypes.STRING(100),
        allowNull: false,
        comment:   'Clave snake_case usada en JSON metadata',
      },
      field_label: {
        type:      DataTypes.STRING(150),
        allowNull: false,
        comment:   'Etiqueta visible en la UI',
      },
      field_type: {
        type:         DataTypes.ENUM('text', 'number', 'date', 'select', 'checkbox', 'textarea'),
        allowNull:    false,
        defaultValue: 'text',
      },
      field_options: {
        type:         DataTypes.JSON,
        allowNull:    true,
        defaultValue: null,
        comment:      'Para field_type=select: [{label, value}]',
      },
      required: {
        type:         DataTypes.BOOLEAN,
        allowNull:    false,
        defaultValue: false,
      },
      sort_order: {
        type:         DataTypes.INTEGER,
        allowNull:    false,
        defaultValue: 0,
      },
      is_active: {
        type:         DataTypes.BOOLEAN,
        allowNull:    false,
        defaultValue: true,
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    await queryInterface.addIndex('tenant_custom_fields', ['tenant_id', 'entity_type', 'field_key'], {
      name:   'uq_tcf_tenant_entity_key',
      unique: true,
    });
    await queryInterface.addIndex('tenant_custom_fields', ['tenant_id', 'entity_type', 'is_active'], {
      name: 'idx_tcf_tenant_entity_active',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_custom_fields');
  },
};

'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('config_items')) return;
    const cols = await queryInterface.describeTable('config_items').catch(() => null);
    if (!cols || cols.tenant_id) return;

    await queryInterface.addColumn('config_items', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      references:   { model: 'tenants', key: 'id' },
      onDelete:     'SET NULL',
      after:        'id',
    });
    await queryInterface.sequelize.query(
      'UPDATE config_items SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
    await queryInterface.addIndex('config_items', ['tenant_id'], { name: 'idx_config_items_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('config_items', 'idx_config_items_tenant_id').catch(() => {});
    await queryInterface.removeColumn('config_items', 'tenant_id').catch(() => {});
  },
};

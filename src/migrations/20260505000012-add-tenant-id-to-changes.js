'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('changes')) return;
    const cols = await queryInterface.describeTable('changes').catch(() => null);
    if (!cols || cols.tenant_id) return;
    await queryInterface.addColumn('changes', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      references:   { model: 'tenants', key: 'id' },
      onDelete:     'SET NULL',
      after:        'id',
    });
    await queryInterface.sequelize.query(
      'UPDATE changes SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
    await queryInterface.addIndex('changes', ['tenant_id'], { name: 'idx_changes_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('changes', 'idx_changes_tenant_id').catch(() => {});
    await queryInterface.removeColumn('changes', 'tenant_id').catch(() => {});
  },
};

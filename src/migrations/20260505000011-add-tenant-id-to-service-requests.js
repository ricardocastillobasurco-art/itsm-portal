'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('service_requests')) return;
    const cols = await queryInterface.describeTable('service_requests').catch(() => null);
    if (!cols || cols.tenant_id) return;
    await queryInterface.addColumn('service_requests', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      references:   { model: 'tenants', key: 'id' },
      onDelete:     'SET NULL',
      after:        'id',
    });
    await queryInterface.sequelize.query(
      'UPDATE service_requests SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
    await queryInterface.addIndex('service_requests', ['tenant_id'], { name: 'idx_service_requests_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('service_requests', 'idx_service_requests_tenant_id').catch(() => {});
    await queryInterface.removeColumn('service_requests', 'tenant_id').catch(() => {});
  },
};

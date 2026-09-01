'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('tickets')) return;
    const cols = await queryInterface.describeTable('tickets').catch(() => null);
    if (!cols || cols.tenant_id) return;
    await queryInterface.addColumn('tickets', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      references:   { model: 'tenants', key: 'id' },
      onDelete:     'SET NULL',
      after:        'id',
    });
    await queryInterface.sequelize.query(
      'UPDATE tickets SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
    await queryInterface.addIndex('tickets', ['tenant_id'], { name: 'idx_tickets_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('tickets', 'idx_tickets_tenant_id').catch(() => {});
    await queryInterface.removeColumn('tickets', 'tenant_id').catch(() => {});
  },
};

'use strict';
const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('ticket_categories')) return;
    const cols = await queryInterface.describeTable('ticket_categories').catch(() => null);
    if (!cols || cols.tenant_id) return;
    await queryInterface.addColumn('ticket_categories', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      references:   { model: 'tenants', key: 'id' },
      onDelete:     'CASCADE',
      after:        'id',
    });
    await queryInterface.addIndex('ticket_categories', ['tenant_id'], { name: 'ticket_categories_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
    await queryInterface.sequelize.query(
      'UPDATE ticket_categories SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('ticket_categories', 'ticket_categories_tenant_id').catch(() => {});
    await queryInterface.removeColumn('ticket_categories', 'tenant_id').catch(() => {});
  },
};

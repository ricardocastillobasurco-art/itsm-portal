'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('users')) return;
    const cols = await queryInterface.describeTable('users').catch(() => null);
    if (!cols || cols.tenant_id) return;

    await queryInterface.addColumn('users', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      after:        'id',
      references:   { model: 'tenants', key: 'id' },
      onUpdate:     'CASCADE',
      onDelete:     'SET NULL',
    });

    await queryInterface.addIndex('users', ['tenant_id'], { name: 'idx_users_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });

    await queryInterface.sequelize.query(
      'UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'idx_users_tenant_id').catch(() => {});
    await queryInterface.removeColumn('users', 'tenant_id').catch(() => {});
  },
};

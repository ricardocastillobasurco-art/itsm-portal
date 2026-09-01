'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('kb_articles')) return;
    const cols = await queryInterface.describeTable('kb_articles').catch(() => null);
    if (!cols || cols.tenant_id) return;

    await queryInterface.addColumn('kb_articles', 'tenant_id', {
      type:         DataTypes.INTEGER.UNSIGNED,
      allowNull:    true,
      defaultValue: null,
      references:   { model: 'tenants', key: 'id' },
      onDelete:     'SET NULL',
      after:        'id',
    });
    await queryInterface.sequelize.query(
      'UPDATE kb_articles SET tenant_id = 1 WHERE tenant_id IS NULL'
    );
    await queryInterface.addIndex('kb_articles', ['tenant_id'], { name: 'idx_kb_articles_tenant_id' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('kb_articles', 'idx_kb_articles_tenant_id').catch(() => {});
    await queryInterface.removeColumn('kb_articles', 'tenant_id').catch(() => {});
  },
};

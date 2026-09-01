'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tableInfo = await queryInterface.describeTable('tenants');

    if (!tableInfo.domain) {
      await queryInterface.addColumn('tenants', 'domain', {
        type:      DataTypes.STRING(100),
        allowNull: true,
        after:     'slug',
      });
    }
    if (!tableInfo.contact_email) {
      await queryInterface.addColumn('tenants', 'contact_email', {
        type:      DataTypes.STRING(255),
        allowNull: true,
        after:     'domain',
      });
    }

    try {
      await queryInterface.addIndex('tenants', ['domain'], {
        name:   'idx_tenants_domain',
        unique: true,
      });
    } catch (e) {
      // índice ya existe — ignorar
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeIndex('tenants', 'idx_tenants_domain'); } catch {}
    try { await queryInterface.removeColumn('tenants', 'contact_email'); } catch {}
    try { await queryInterface.removeColumn('tenants', 'domain'); } catch {}
  },
};

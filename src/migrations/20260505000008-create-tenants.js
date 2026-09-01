'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('tenants')) {
      await queryInterface.createTable('tenants', {
        id: {
          type:          DataTypes.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey:    true,
        },
        slug: {
          type:      DataTypes.STRING(100),
          allowNull: false,
          unique:    true,
        },
        name: {
          type:      DataTypes.STRING(255),
          allowNull: false,
        },
        plan: {
          type:         DataTypes.ENUM('trial', 'starter', 'professional', 'enterprise'),
          allowNull:    false,
          defaultValue: 'enterprise',
        },
        settings: {
          type:         DataTypes.JSON,
          allowNull:    true,
          defaultValue: null,
        },
        is_active: {
          type:         DataTypes.BOOLEAN,
          allowNull:    false,
          defaultValue: true,
        },
        created_at: {
          type:         DataTypes.DATE,
          allowNull:    false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type:         DataTypes.DATE,
          allowNull:    false,
          defaultValue: DataTypes.NOW,
        },
      });

      try { await queryInterface.addIndex('tenants', ['slug'],      { name: 'idx_tenants_slug',      unique: true }); } catch (e) { if (!e.message.includes('Duplicate key name')) throw e; }
      try { await queryInterface.addIndex('tenants', ['is_active'], { name: 'idx_tenants_is_active' }); }              catch (e) { if (!e.message.includes('Duplicate key name')) throw e; }
    }

    // Seed default tenant (INSERT IGNORE is safe if it already exists)
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO tenants (id, slug, name, plan, settings, is_active, created_at, updated_at) VALUES (1, :slug, :name, 'enterprise', NULL, 1, NOW(), NOW())`,
      { replacements: {
          slug: process.env.DEFAULT_TENANT_SLUG || 'default',
          name: process.env.DEFAULT_TENANT_NAME || 'Default',
        },
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenants');
  },
};

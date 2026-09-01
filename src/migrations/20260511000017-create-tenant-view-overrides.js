'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('tenant_view_overrides')) return;
    await queryInterface.createTable('tenant_view_overrides', {
      id: {
        type:          DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey:    true,
      },
      tenant_id: {
        type:       DataTypes.INTEGER.UNSIGNED,
        allowNull:  false,
        unique:     true,
        references: { model: 'tenants', key: 'id' },
        onDelete:   'CASCADE',
      },
      company_name:    { type: DataTypes.STRING(255), allowNull: true },
      logo_url:        { type: DataTypes.STRING(500), allowNull: true },
      favicon_url:     { type: DataTypes.STRING(500), allowNull: true },
      primary_color:   { type: DataTypes.STRING(7),   allowNull: true, comment: 'Hex #RRGGBB' },
      secondary_color: { type: DataTypes.STRING(7),   allowNull: true, comment: 'Hex #RRGGBB' },
      custom_css:      { type: DataTypes.TEXT,        allowNull: true },
      created_at:      { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at:      { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    await queryInterface.addIndex('tenant_view_overrides', ['tenant_id'], {
      name:   'uq_tenant_view_overrides_tenant',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_view_overrides');
  },
};

'use strict';
const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const cols = await queryInterface.describeTable('users').catch(() => null);
    if (!cols) return;
    if (!cols.ms_home_account_id)
      await queryInterface.addColumn('users', 'ms_home_account_id', { type: DataTypes.STRING(255), allowNull: true, defaultValue: null });
    if (!cols.ms_token_cache)
      await queryInterface.addColumn('users', 'ms_token_cache', { type: DataTypes.TEXT('medium'), allowNull: true, defaultValue: null });
    if (!cols.ms_scopes_granted)
      await queryInterface.addColumn('users', 'ms_scopes_granted', { type: DataTypes.TEXT, allowNull: true, defaultValue: null });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'ms_home_account_id').catch(() => {});
    await queryInterface.removeColumn('users', 'ms_token_cache').catch(() => {});
    await queryInterface.removeColumn('users', 'ms_scopes_granted').catch(() => {});
  },
};

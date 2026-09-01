'use strict';

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('equipment')) return;
    const cols = await queryInterface.describeTable('equipment').catch(() => null);
    if (!cols || cols.is_stolen) return;
    await queryInterface.sequelize.query(
      'ALTER TABLE equipment ADD COLUMN is_stolen TINYINT(1) NOT NULL DEFAULT 0 AFTER status'
    );
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE equipment DROP COLUMN is_stolen'
    ).catch(() => {});
  },
};

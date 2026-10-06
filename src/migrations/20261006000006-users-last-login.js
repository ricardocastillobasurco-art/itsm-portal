'use strict';

// users.last_login: el login ya lo actualiza y lo usan el equipo del onboarding y
// la lista de empresas inactivas, pero las instalaciones nuevas no lo tenían.
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const cols = await queryInterface.describeTable('users');
    if (!cols.last_login) await queryInterface.sequelize.query('ALTER TABLE users ADD COLUMN last_login DATETIME NULL');
  },
  async down() {},
};

'use strict';

// users table is missing phone, specialty, and created_by columns referenced
// in GET/POST /api/jira/specialists routes, causing 'Unknown column' errors.
// created_by must be VARCHAR(36) because users.id is a UUID, not INT.
module.exports = {
  async up(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql).catch(() => {});
    await q(`ALTER TABLE users ADD COLUMN phone      VARCHAR(30)  NULL AFTER email`);
    await q(`ALTER TABLE users ADD COLUMN specialty  VARCHAR(100) NULL AFTER phone`);
    await q(`ALTER TABLE users ADD COLUMN created_by VARCHAR(36)  NULL`);
  },
  async down(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql).catch(() => {});
    await q(`ALTER TABLE users DROP COLUMN created_by`);
    await q(`ALTER TABLE users DROP COLUMN specialty`);
    await q(`ALTER TABLE users DROP COLUMN phone`);
  },
};

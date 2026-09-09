'use strict';

// portal_banners.created_by was INT but users.id is a UUID (VARCHAR(36)).
// MySQL truncated the UUID string to 0, causing "Data truncated" on INSERT.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE portal_banners MODIFY created_by VARCHAR(36) NULL`
    ).catch(() => {});
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE portal_banners MODIFY created_by INT NULL`
    ).catch(() => {});
  },
};

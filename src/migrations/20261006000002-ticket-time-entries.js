'use strict';

// Registro de tiempo por ticket (horas de soporte por cliente, para facturar).
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const tables = new Set(await queryInterface.showAllTables());
    if (tables.has('ticket_time_entries')) return;
    await queryInterface.sequelize.query(`CREATE TABLE ticket_time_entries (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id   INT NOT NULL,
        ticket_key  VARCHAR(50) NOT NULL,
        user_id     VARCHAR(36) NULL,
        user_name   VARCHAR(150) NULL,
        minutes     INT NOT NULL,
        billable    TINYINT(1) NOT NULL DEFAULT 1,
        note        VARCHAR(500) NULL,
        work_date   DATE NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tte_ticket (tenant_id, ticket_key),
        KEY idx_tte_date (tenant_id, work_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  },
  async down() {},
};

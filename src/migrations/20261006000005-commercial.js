'use strict';

// Comercial: solicitudes de plan Pro / soporte gestionado desde el producto
// (sales_requests) y control de avisos del cobro manual (tenant_billing).
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const tables = new Set(await queryInterface.showAllTables());

    if (!tables.has('sales_requests')) {
      await q(`CREATE TABLE sales_requests (
          id          INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id   INT NOT NULL,
          type        VARCHAR(20) NOT NULL,
          data        TEXT NULL,
          status      VARCHAR(20) NOT NULL DEFAULT 'nuevo',
          notes       TEXT NULL,
          created_by  VARCHAR(36) NULL,
          contact     VARCHAR(255) NULL,
          created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_sales_requests_status (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }

    if (!tables.has('tenant_billing')) {
      await q(`CREATE TABLE tenant_billing (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id    INT NOT NULL,
          renewal_date DATE NULL,
          amount       DECIMAL(10,2) NULL,
          currency     VARCHAR(10) DEFAULT 'USD',
          status       ENUM('paid','pending','overdue') DEFAULT 'pending',
          notes        TEXT NULL,
          created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_tenant (tenant_id),
          KEY idx_renewal (renewal_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    const cols = await queryInterface.describeTable('tenant_billing');
    if (!cols.reminder_sent_at) await q('ALTER TABLE tenant_billing ADD COLUMN reminder_sent_at DATETIME NULL');
    if (!cols.overdue_notified_at) await q('ALTER TABLE tenant_billing ADD COLUMN overdue_notified_at DATETIME NULL');
  },
  async down() {},
};

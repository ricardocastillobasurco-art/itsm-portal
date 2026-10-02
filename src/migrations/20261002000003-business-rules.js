'use strict';

// Tabla business_rules (modelo src/models/platform/BusinessRule.js, motor
// src/rules/engine.js, rutas /api/business-rules). El modelo existía pero la
// tabla nunca se creó: la pantalla de reglas fallaba con "table doesn't exist".
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const tables = new Set(await queryInterface.showAllTables());
    if (tables.has('business_rules')) return;
    await queryInterface.sequelize.query(`CREATE TABLE business_rules (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id   INT NOT NULL DEFAULT 1,
        name        VARCHAR(150) NOT NULL,
        description TEXT NULL,
        conditions  JSON NOT NULL,
        actions     JSON NOT NULL,
        is_active   TINYINT(1) NOT NULL DEFAULT 1,
        priority    INT NOT NULL DEFAULT 10,
        run_on      ENUM('ticket_created','ticket_updated','sla_check') NOT NULL DEFAULT 'ticket_created',
        created_by  CHAR(36) NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_business_rules_tenant (tenant_id, is_active, priority)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  },
  async down() {},
};

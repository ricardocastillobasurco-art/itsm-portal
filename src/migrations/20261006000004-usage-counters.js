'use strict';

// Contadores de uso mensual por empresa (p. ej. conversaciones del chatbot con IA),
// para los límites del plan (PlanService). Idempotente.

module.exports = {
  async up(queryInterface) {
    const tables = new Set(await queryInterface.showAllTables());
    if (tables.has('usage_counters')) return;
    await queryInterface.sequelize.query(`CREATE TABLE usage_counters (
        tenant_id  INT NOT NULL,
        metric     VARCHAR(40) NOT NULL,
        period     CHAR(7) NOT NULL,
        value      INT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, metric, period)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  },
  async down() {},
};

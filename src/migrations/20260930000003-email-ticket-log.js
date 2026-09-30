'use strict';

// Registro de correos procesados por "correo a ticket": evita procesar dos veces
// el mismo mensaje (message_id por tenant) y deja trazabilidad de lo ignorado.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS email_ticket_log (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id   INT          NOT NULL,
        message_id  VARCHAR(255) NOT NULL,
        from_email  VARCHAR(255) NULL,
        subject     VARCHAR(500) NULL,
        action      ENUM('created','comment','ignored','error') NOT NULL,
        ticket_key  VARCHAR(50)  NULL,
        reason      VARCHAR(255) NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tenant_message (tenant_id, message_id),
        INDEX idx_tenant_created (tenant_id, created_at),
        INDEX idx_tenant_from (tenant_id, from_email, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS email_ticket_log');
  },
};

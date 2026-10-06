'use strict';

// Técnicos multiempresa: acceso de un usuario de TI a empresas distintas de la suya
// (CompanyAccessService). user_id es texto porque users.id es UUID o numérico según
// la instalación. Idempotente.

module.exports = {
  async up(queryInterface) {
    const tables = new Set(await queryInterface.showAllTables());
    if (tables.has('user_tenant_access')) return;
    await queryInterface.sequelize.query(`CREATE TABLE user_tenant_access (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     VARCHAR(36) NOT NULL,
        tenant_id   INT NOT NULL,
        role        VARCHAR(30) NOT NULL DEFAULT 'especialista',
        granted_by  VARCHAR(36) NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_tenant_access (user_id, tenant_id),
        KEY idx_uta_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  },
  async down() {},
};

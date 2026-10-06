'use strict';

// Registro autoservicio (SignupService):
//  - tenants.plan admite 'free' (plan Gratis); tenants.trial_ends_at y signup_source.
//  - signup_invites: enlaces de invitación (se guarda solo el hash del token).
//  - signup_requests: registros pendientes de verificar el correo.
//  - platform_settings: configuración de la plataforma editable por el superadmin
//    (modo de registro, días de prueba, límites por plan, marca...).
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const tables = new Set(await queryInterface.showAllTables());

    if (tables.has('tenants')) {
      const [[col]] = await q("SHOW COLUMNS FROM tenants LIKE 'plan'");
      if (col && !String(col.Type).includes("'free'")) {
        await q("ALTER TABLE tenants MODIFY plan ENUM('trial','starter','professional','enterprise','free') NOT NULL DEFAULT 'trial'");
      }
      const cols = await queryInterface.describeTable('tenants');
      if (!cols.trial_ends_at) await q('ALTER TABLE tenants ADD COLUMN trial_ends_at DATETIME NULL');
      if (!cols.signup_source) await q('ALTER TABLE tenants ADD COLUMN signup_source VARCHAR(20) NULL');
    }

    if (!tables.has('signup_invites')) {
      await q(`CREATE TABLE signup_invites (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          token_hash     CHAR(64) NOT NULL,
          email          VARCHAR(255) NULL,
          company_name   VARCHAR(255) NULL,
          note           VARCHAR(500) NULL,
          created_by     VARCHAR(36) NULL,
          expires_at     DATETIME NOT NULL,
          used_at        DATETIME NULL,
          used_tenant_id INT NULL,
          revoked_at     DATETIME NULL,
          created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_signup_invites_token (token_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }

    if (!tables.has('signup_requests')) {
      await q(`CREATE TABLE signup_requests (
          id            INT AUTO_INCREMENT PRIMARY KEY,
          email         VARCHAR(255) NOT NULL,
          full_name     VARCHAR(150) NOT NULL,
          company_name  VARCHAR(255) NOT NULL,
          country       VARCHAR(60) NULL,
          domain        VARCHAR(255) NULL,
          password_hash VARCHAR(255) NOT NULL,
          invite_id     INT NULL,
          code_hash     CHAR(64) NOT NULL,
          code_plain    VARCHAR(10) NULL,
          attempts      INT NOT NULL DEFAULT 0,
          ip            VARCHAR(64) NULL,
          expires_at    DATETIME NOT NULL,
          verified_at   DATETIME NULL,
          tenant_id     INT NULL,
          created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_signup_requests_email (email),
          KEY idx_signup_requests_ip (ip, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }

    if (!tables.has('platform_settings')) {
      await q(`CREATE TABLE platform_settings (
          \`key\`     VARCHAR(100) NOT NULL PRIMARY KEY,
          value      TEXT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  },
  async down() {},
};

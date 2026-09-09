'use strict';

module.exports = {
  async up(queryInterface, DataTypes) {
    const q = sql => queryInterface.sequelize.query(sql);

    // Añadir 'fallido' y 'revisado' al ENUM de changes.status si aún no están
    await q(`
      ALTER TABLE changes
        MODIFY COLUMN status ENUM(
          'borrador','pendiente_aprobacion','aprobado',
          'en_implementacion','implementado','fallido','cancelado','revisado'
        ) NOT NULL DEFAULT 'borrador'
    `).catch(() => {}); // silenciar si la tabla no existe aún o el ENUM ya está completo


    await q(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id          CHAR(36)     NOT NULL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        description TEXT         DEFAULT NULL,
        icon        VARCHAR(50)  DEFAULT NULL,
        is_active   TINYINT(1)   NOT NULL DEFAULT 1,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS services (
        id                CHAR(36)     NOT NULL PRIMARY KEY,
        category_id       CHAR(36)     NOT NULL,
        name              VARCHAR(150) NOT NULL,
        description       TEXT         DEFAULT NULL,
        sla_hours         INT          NOT NULL DEFAULT 8,
        approval_required TINYINT(1)   NOT NULL DEFAULT 0,
        approver_role     VARCHAR(50)  DEFAULT NULL,
        form_schema       JSON         DEFAULT NULL,
        is_active         TINYINT(1)   NOT NULL DEFAULT 1,
        created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at        DATETIME     DEFAULT NULL,
        KEY idx_svc_cat (category_id),
        KEY idx_svc_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS services');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS service_categories');
  },
};

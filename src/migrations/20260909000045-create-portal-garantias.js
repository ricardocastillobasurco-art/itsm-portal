'use strict';

// portal_garantias is created by an IIFE in routes/experience/portal.js, but
// that IIFE uses catch(e){} (completely silent), so if it fails in Railway the
// table never exists. This migration ensures it is always created on deploy.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS portal_garantias (
        id               INT          AUTO_INCREMENT PRIMARY KEY,
        employee_id      INT          DEFAULT NULL,
        employee_email   VARCHAR(200),
        employee_name    VARCHAR(200),
        equipment_id     INT          DEFAULT NULL,
        equipment_name   VARCHAR(200),
        tipo             VARCHAR(20)  NOT NULL DEFAULT 'tecnica',
        pieza            VARCHAR(100),
        descripcion      TEXT,
        urgencia         VARCHAR(20)  DEFAULT 'normal',
        cuando_ocurrio   DATE         DEFAULT NULL,
        donde_ocurrio    TEXT,
        hora_ocurrio     VARCHAR(10),
        denuncia_data    LONGTEXT,
        firma_digital    LONGTEXT,
        foto_data        LONGTEXT,
        status           VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        created_at       DATETIME     DEFAULT NOW(),
        INDEX idx_email    (employee_email),
        INDEX idx_employee (employee_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS portal_garantias');
  },
};

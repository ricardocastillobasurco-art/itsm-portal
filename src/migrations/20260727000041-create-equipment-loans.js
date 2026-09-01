'use strict';

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const q = sql => sequelize.query(sql);
        await q(`
            CREATE TABLE IF NOT EXISTS equipment_loans (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                equipment_id    INT NOT NULL,
                prestado_a      VARCHAR(255) NOT NULL,
                prestado_desde  DATE NOT NULL,
                prestado_hasta  DATE NOT NULL,
                estado          ENUM('activo','devuelto') NOT NULL DEFAULT 'activo',
                devuelto_at     DATETIME DEFAULT NULL,
                notes           TEXT DEFAULT NULL,
                created_by      VARCHAR(150) DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_el_equipment (equipment_id),
                INDEX idx_el_estado (estado)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },
    async down(queryInterface) {
        await queryInterface.sequelize.query('DROP TABLE IF EXISTS equipment_loans');
    }
};

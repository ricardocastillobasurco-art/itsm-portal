'use strict';

// Tablas legacy del sistema de activos (no gestionadas por Sequelize ORM)
module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const q = sql => sequelize.query(sql);

        await q(`
            CREATE TABLE IF NOT EXISTS departments (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                department_name VARCHAR(150) NOT NULL,
                division        VARCHAR(150) DEFAULT NULL,
                subactivity     VARCHAR(150) DEFAULT NULL,
                is_active       TINYINT(1)  NOT NULL DEFAULT 1,
                desc_ceo        VARCHAR(150) DEFAULT NULL,
                desc_ceo_1      VARCHAR(150) DEFAULT NULL,
                desc_ceo_2      VARCHAR(150) DEFAULT NULL,
                desc_ceo_3      VARCHAR(150) DEFAULT NULL,
                desc_ceo_4      VARCHAR(150) DEFAULT NULL,
                desc_ceo_5      VARCHAR(150) DEFAULT NULL,
                desc_ceo_6      VARCHAR(150) DEFAULT NULL,
                desc_ceo_7      VARCHAR(150) DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_dept_name (department_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS locations (
                id               INT PRIMARY KEY,
                branch_office_id VARCHAR(100) NOT NULL,
                location_name    VARCHAR(150) NOT NULL,
                city             VARCHAR(100) DEFAULT NULL,
                state            VARCHAR(100) DEFAULT NULL,
                country          VARCHAR(100) DEFAULT 'Perú',
                is_active        TINYINT(1)  NOT NULL DEFAULT 1,
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_branch (branch_office_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS employees (
                id               INT PRIMARY KEY,
                cip              VARCHAR(50)  NOT NULL,
                national_id      VARCHAR(20)  DEFAULT NULL,
                document_type    VARCHAR(20)  DEFAULT 'DNI',
                full_name        VARCHAR(150) NOT NULL,
                email            VARCHAR(255) DEFAULT NULL,
                network_account  VARCHAR(100) DEFAULT NULL,
                position_name    VARCHAR(150) DEFAULT NULL,
                category         VARCHAR(100) DEFAULT NULL,
                employee_group   ENUM('EMP','EJC','OTROS') DEFAULT NULL,
                legal_entity     VARCHAR(100) DEFAULT NULL,
                supervisor_name  VARCHAR(150) DEFAULT NULL,
                branch_office_id VARCHAR(100) DEFAULT NULL,
                state            VARCHAR(100) DEFAULT NULL,
                department_id    INT          DEFAULT NULL,
                is_active        TINYINT(1)  NOT NULL DEFAULT 1,
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at       DATETIME DEFAULT NULL,
                UNIQUE KEY uq_cip   (cip),
                UNIQUE KEY uq_email (email),
                KEY idx_emp_dept (department_id),
                KEY idx_emp_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS equipment (
                id                 INT PRIMARY KEY AUTO_INCREMENT,
                device_code        VARCHAR(100) NOT NULL,
                serial_number      VARCHAR(100) DEFAULT NULL,
                equipment_type     ENUM('Laptop','Desktop','Tablet','Smartphone','Monitor','Servidor','Impresora','Otro') DEFAULT 'Otro',
                brand              VARCHAR(100) DEFAULT NULL,
                model              VARCHAR(150) DEFAULT NULL,
                processor          VARCHAR(150) DEFAULT NULL,
                operating_system   VARCHAR(100) DEFAULT NULL,
                disk_capacity      VARCHAR(50)  DEFAULT NULL,
                ram_memory         VARCHAR(50)  DEFAULT NULL,
                acquisition_type   ENUM('Propio','Arrendado','Leasing','Donado') DEFAULT 'Propio',
                warranty_months    INT          DEFAULT NULL,
                obsolescence_years INT          DEFAULT NULL,
                domain             VARCHAR(100) DEFAULT NULL,
                it_level_1         VARCHAR(100) DEFAULT NULL,
                it_level_2         VARCHAR(100) DEFAULT NULL,
                status             VARCHAR(50)  NOT NULL DEFAULT 'Disponible',
                is_stolen          TINYINT(1)  NOT NULL DEFAULT 0,
                created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at         DATETIME DEFAULT NULL,
                UNIQUE KEY uq_device_code   (device_code),
                UNIQUE KEY uq_serial_number (serial_number),
                KEY idx_eq_status (status),
                KEY idx_eq_type   (equipment_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS assignments (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                employee_id     INT          NOT NULL,
                equipment_id    INT          NOT NULL,
                department_id   INT          DEFAULT NULL,
                location_id     INT          DEFAULT NULL,
                assignment_date DATE         DEFAULT NULL,
                return_date     DATE         DEFAULT NULL,
                period          VARCHAR(20)  DEFAULT NULL,
                status          ENUM('Activo','Finalizado','Cancelado') NOT NULL DEFAULT 'Activo',
                notes           TEXT         DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at      DATETIME DEFAULT NULL,
                KEY idx_asgn_employee  (employee_id),
                KEY idx_asgn_equipment (equipment_id),
                KEY idx_asgn_status    (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS warranty_records (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                equipment_id    INT          NOT NULL,
                warranty_type   VARCHAR(100) DEFAULT NULL,
                vendor          VARCHAR(150) DEFAULT NULL,
                start_date      DATE         DEFAULT NULL,
                end_date        DATE         DEFAULT NULL,
                contract_number VARCHAR(100) DEFAULT NULL,
                notes           TEXT         DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at      DATETIME DEFAULT NULL,
                KEY idx_wrt_equipment (equipment_id),
                KEY idx_wrt_end_date  (end_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS recoveries (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                equipment_id    INT          NOT NULL,
                employee_id     INT          DEFAULT NULL,
                recovery_date   DATE         DEFAULT NULL,
                reason          VARCHAR(255) DEFAULT NULL,
                recovered_by    VARCHAR(150) DEFAULT NULL,
                notes           TEXT         DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at      DATETIME DEFAULT NULL,
                KEY idx_rec_equipment (equipment_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Vista: asignaciones activas con datos de empleado y equipo
        // DROP TABLE first in case legacy DB has a table instead of view
        await q(`DROP TABLE IF EXISTS active_assignments_view`);
        await q(`DROP VIEW  IF EXISTS active_assignments_view`);
        await q(`
            CREATE VIEW active_assignments_view AS
            SELECT
                a.id,
                a.employee_id,
                a.equipment_id,
                a.department_id,
                a.location_id,
                a.assignment_date,
                a.return_date,
                a.period,
                a.status,
                e.cip          AS employee_cip,
                e.full_name    AS employee_name,
                e.email        AS employee_email,
                e.position_name,
                eq.device_code AS equipment_code,
                eq.serial_number,
                eq.equipment_type,
                eq.brand,
                eq.model,
                eq.status      AS equipment_status,
                d.department_name,
                l.location_name
            FROM assignments a
            LEFT JOIN employees  e  ON e.id  = a.employee_id
            LEFT JOIN equipment  eq ON eq.id = a.equipment_id
            LEFT JOIN departments d ON d.id  = a.department_id
            LEFT JOIN locations   l ON l.id  = a.location_id
            WHERE a.status = 'Activo' AND a.deleted_at IS NULL
        `);

        // Vista: disponibilidad de equipos
        await q(`DROP TABLE IF EXISTS equipment_availability`);
        await q(`DROP VIEW  IF EXISTS equipment_availability`);
        await q(`
            CREATE VIEW equipment_availability AS
            SELECT
                eq.*,
                CASE WHEN a.id IS NOT NULL THEN 'Asignado' ELSE eq.status END AS availability_status,
                e.full_name  AS assigned_to_name,
                e.cip        AS assigned_to_cip,
                e.email      AS assigned_to_email,
                d.department_name,
                l.location_name
            FROM equipment eq
            LEFT JOIN assignments a ON a.equipment_id = eq.id AND a.status = 'Activo' AND a.deleted_at IS NULL
            LEFT JOIN employees   e ON e.id = a.employee_id
            LEFT JOIN departments d ON d.id = a.department_id
            LEFT JOIN locations   l ON l.id = a.location_id
            WHERE eq.deleted_at IS NULL
        `);
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        await sequelize.query(`DROP VIEW IF EXISTS equipment_availability`);
        await sequelize.query(`DROP VIEW IF EXISTS active_assignments_view`);
        for (const t of ['recoveries','warranty_records','assignments','equipment','employees','locations','departments']) {
            await sequelize.query(`DROP TABLE IF EXISTS \`${t}\``);
        }
    },
};

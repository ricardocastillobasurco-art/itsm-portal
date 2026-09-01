'use strict';

// Tablas operativas legacy: recuperos, fallas, traslados, mantenimiento, inventario SCCM
module.exports = {
    async up(queryInterface) {
        const q = sql => queryInterface.sequelize.query(sql);

        await q(`
            CREATE TABLE IF NOT EXISTS equipment_recoveries (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                assignment_id    INT          DEFAULT NULL,
                equipment_id     INT          NOT NULL,
                employee_id      INT          NOT NULL,
                recovery_method  VARCHAR(50)  DEFAULT 'pendiente',
                technician_name  VARCHAR(150) DEFAULT NULL,
                technician_note  TEXT         DEFAULT NULL,
                scheduled_date   DATE         DEFAULT NULL,
                completed_at     DATETIME     DEFAULT NULL,
                notes            TEXT         DEFAULT NULL,
                status           ENUM('por_recuperar','en_gestion','recogido_tecnico','traido_oficina','en_revision','listo_para_asignar','recuperado')
                                 NOT NULL DEFAULT 'por_recuperar',
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_rec_equipment (equipment_id),
                KEY idx_rec_employee  (employee_id),
                KEY idx_rec_status    (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS equipment_recovery_logs (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                recovery_id  INT          NOT NULL,
                new_status   VARCHAR(50)  DEFAULT NULL,
                note         TEXT         DEFAULT NULL,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                KEY idx_reclog_recovery (recovery_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS equipment_faults (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                equipment_id    INT          NOT NULL,
                description     TEXT         NOT NULL,
                component       VARCHAR(100) NOT NULL,
                supplier        VARCHAR(150) DEFAULT NULL,
                estimated_cost  DECIMAL(10,2) DEFAULT NULL,
                repair_status   ENUM('Pendiente','En proceso','Esperando repuesto','Resuelto','Dado de baja')
                                NOT NULL DEFAULT 'Pendiente',
                registered_by   VARCHAR(100) DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_fault_equipment (equipment_id),
                KEY idx_fault_status    (repair_status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS equipment_transfers (
                id                       INT AUTO_INCREMENT PRIMARY KEY,
                equipment_id             INT          NOT NULL,
                origin_location_id       INT          DEFAULT NULL,
                destination_location_id  INT          NOT NULL,
                transfer_date            DATE         NOT NULL,
                notes                    TEXT         DEFAULT NULL,
                created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_transfer_equipment (equipment_id),
                KEY idx_transfer_date      (transfer_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS equipment_maintenance (
                id                INT AUTO_INCREMENT PRIMARY KEY,
                equipment_id      INT          NOT NULL,
                employee_id       INT          DEFAULT NULL,
                maintenance_date  DATE         NOT NULL,
                maintenance_type  VARCHAR(100) DEFAULT NULL,
                component_name    VARCHAR(150) DEFAULT NULL,
                component_brand   VARCHAR(100) DEFAULT NULL,
                component_model   VARCHAR(150) DEFAULT NULL,
                serial_number     VARCHAR(100) DEFAULT NULL,
                notes             TEXT         DEFAULT NULL,
                cost              DECIMAL(10,2) DEFAULT NULL,
                technician_name   VARCHAR(150) DEFAULT NULL,
                warranty_months   INT          DEFAULT NULL,
                warranty_end_date DATE         DEFAULT NULL,
                status            VARCHAR(50)  DEFAULT 'Completado',
                created_by        VARCHAR(100) DEFAULT NULL,
                created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_maint_equipment (equipment_id),
                KEY idx_maint_date      (maintenance_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Tabla de inventario SCCM / Panda EPDR (sincronizada desde correo Stefanini)
        await q(`
            CREATE TABLE IF NOT EXISTS sccm_inventory (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                hostname            VARCHAR(150) NOT NULL,
                bios_serial         VARCHAR(150) DEFAULT NULL,
                cliente             VARCHAR(150) DEFAULT NULL,
                tipo_equipo         VARCHAR(100) DEFAULT NULL,
                descripcion         VARCHAR(255) DEFAULT NULL,
                ip_local            VARCHAR(45)  DEFAULT NULL,
                ip_publica          VARCHAR(45)  DEFAULT NULL,
                mac_address         VARCHAR(100) DEFAULT NULL,
                dominio             VARCHAR(150) DEFAULT NULL,
                directorio_activo   VARCHAR(255) DEFAULT NULL,
                ultimo_proxy        VARCHAR(150) DEFAULT NULL,
                plataforma          VARCHAR(100) DEFAULT NULL,
                sistema_operativo   VARCHAR(255) DEFAULT NULL,
                sistema_modelo      VARCHAR(255) DEFAULT NULL,
                cpu_1               VARCHAR(255) DEFAULT NULL,
                cpu_1_nucleos       VARCHAR(50)  DEFAULT NULL,
                cpu_1_procesadores  VARCHAR(50)  DEFAULT NULL,
                cpu_2               VARCHAR(255) DEFAULT NULL,
                cpu_2_nucleos       VARCHAR(50)  DEFAULT NULL,
                cpu_2_procesadores  VARCHAR(50)  DEFAULT NULL,
                memoria_ram         VARCHAR(100) DEFAULT NULL,
                disco_1_capacidad   VARCHAR(100) DEFAULT NULL,
                disco_1_particiones VARCHAR(100) DEFAULT NULL,
                disco_2_capacidad   VARCHAR(100) DEFAULT NULL,
                disco_2_particiones VARCHAR(100) DEFAULT NULL,
                disco_3_capacidad   VARCHAR(100) DEFAULT NULL,
                disco_3_particiones VARCHAR(100) DEFAULT NULL,
                disco_4_capacidad   VARCHAR(100) DEFAULT NULL,
                disco_4_particiones VARCHAR(100) DEFAULT NULL,
                tpm_version         VARCHAR(50)  DEFAULT NULL,
                grupo               VARCHAR(150) DEFAULT NULL,
                version_agente      VARCHAR(100) DEFAULT NULL,
                es_virtual          TINYINT(1)   DEFAULT 0,
                ultimo_usuario      VARCHAR(150) DEFAULT NULL,
                ultimo_inicio       DATETIME     DEFAULT NULL,
                source_email        VARCHAR(255) DEFAULT NULL,
                file_type           ENUM('hardware','security','fusionado') DEFAULT 'hardware',
                synced_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_hostname    (hostname),
                KEY idx_sccm_bios         (bios_serial),
                KEY idx_sccm_dominio      (dominio),
                KEY idx_sccm_file_type    (file_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(queryInterface) {
        for (const t of ['sccm_inventory','equipment_maintenance','equipment_transfers','equipment_faults','equipment_recovery_logs','equipment_recoveries']) {
            await queryInterface.sequelize.query(`DROP TABLE IF EXISTS \`${t}\``);
        }
    },
};

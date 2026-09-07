'use strict';

// Crea las tablas de caché de Jira (jira_tickets, ticket_comments, ticket_history)
// como tablas vacías para que el app funcione en entornos frescos (Railway, staging).
// En producción donde las tablas ya existen, CREATE TABLE IF NOT EXISTS las ignora.

module.exports = {
    async up(queryInterface) {
        const q = sql => queryInterface.sequelize.query(sql);

        await q(`
            CREATE TABLE IF NOT EXISTS jira_tickets (
                id                    INT PRIMARY KEY AUTO_INCREMENT,
                ticket_key            VARCHAR(50)  NOT NULL UNIQUE,
                summary               VARCHAR(500) NOT NULL,
                reporter              VARCHAR(255) DEFAULT NULL,
                device_code           VARCHAR(50)  DEFAULT NULL,
                status                VARCHAR(100) DEFAULT 'Abierto',
                internal_status       ENUM('abierto','asignado','en_progreso','pendiente_usuario','resuelto','cerrado') DEFAULT 'abierto',
                priority              ENUM('P1','P2','P3','P4') DEFAULT 'P3',
                urgency               VARCHAR(50)  DEFAULT NULL,
                urgency_level         INT          DEFAULT 2,
                impact                VARCHAR(50)  DEFAULT NULL,
                impact_label          VARCHAR(100) DEFAULT NULL,
                component             VARCHAR(100) DEFAULT NULL,
                app_item              VARCHAR(100) DEFAULT NULL,
                tipologia             VARCHAR(100) DEFAULT NULL,
                phone                 VARCHAR(50)  DEFAULT NULL,
                description           TEXT,
                jira_url              VARCHAR(500) DEFAULT NULL,
                jira_assignee         VARCHAR(255) DEFAULT NULL,
                jira_account_id       VARCHAR(100) DEFAULT NULL,
                assigned_to           INT          DEFAULT NULL,
                assigned_to_name      VARCHAR(100) DEFAULT NULL,
                assigned_at           DATETIME     DEFAULT NULL,
                first_response_at     DATETIME     DEFAULT NULL,
                resolved_at           DATETIME     DEFAULT NULL,
                resolution_note       TEXT,
                sla_deadline          DATETIME     DEFAULT NULL,
                tipo_atencion         VARCHAR(30)  DEFAULT NULL,
                closed_at             DATETIME     DEFAULT NULL,
                closed_by             VARCHAR(100) DEFAULT NULL,
                close_comment         TEXT,
                wp_resultado_padre    VARCHAR(100) DEFAULT NULL,
                wp_resultado_hijo     VARCHAR(100) DEFAULT NULL,
                derived_to            VARCHAR(100) DEFAULT NULL,
                derived_at            DATETIME     DEFAULT NULL,
                derived_by            VARCHAR(100) DEFAULT NULL,
                derived_note          TEXT,
                escalation_notified_at DATETIME    DEFAULT NULL,
                tenant_id             INT          DEFAULT NULL,
                created_at            DATETIME     DEFAULT CURRENT_TIMESTAMP,
                updated_at            DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_jira_reporter  (reporter),
                INDEX idx_jira_status    (status),
                INDEX idx_jira_priority  (priority),
                INDEX idx_jira_created   (created_at),
                INDEX idx_jira_closed    (closed_at),
                INDEX idx_jira_tenant    (tenant_id),
                INDEX idx_jira_device    (device_code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS ticket_comments (
                id         INT PRIMARY KEY AUTO_INCREMENT,
                ticket_id  VARCHAR(50) NOT NULL,
                user_id    INT DEFAULT 0,
                contenido  TEXT NOT NULL,
                tipo       VARCHAR(30) DEFAULT 'comentario',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ticket (ticket_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS ticket_history (
                id         INT PRIMARY KEY AUTO_INCREMENT,
                ticket_id  VARCHAR(50) NOT NULL,
                user_id    INT DEFAULT 0,
                user_name  VARCHAR(100) DEFAULT 'Sistema',
                evento     VARCHAR(50) NOT NULL,
                detalle    TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ticket  (ticket_id),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS jira_requirements (
                id                INT PRIMARY KEY AUTO_INCREMENT,
                req_key           VARCHAR(50)  NOT NULL UNIQUE,
                summary           VARCHAR(500) NOT NULL,
                description       TEXT,
                reporter          VARCHAR(255),
                tipo              VARCHAR(100),
                priority          ENUM('P1','P2','P3','P4') DEFAULT 'P3',
                status            VARCHAR(100) DEFAULT 'Abierto',
                internal_status   ENUM('abierto','asignado','en_progreso','pendiente_usuario','resuelto','cerrado') DEFAULT 'abierto',
                assigned_to       INT DEFAULT NULL,
                assigned_to_name  VARCHAR(100) DEFAULT NULL,
                assigned_at       DATETIME DEFAULT NULL,
                first_response_at DATETIME DEFAULT NULL,
                resolved_at       DATETIME DEFAULT NULL,
                sla_deadline      DATETIME DEFAULT NULL,
                resolution_note   TEXT DEFAULT NULL,
                closed_at         DATETIME DEFAULT NULL,
                closed_by         VARCHAR(100) DEFAULT NULL,
                close_comment     TEXT DEFAULT NULL,
                phone             VARCHAR(50),
                jira_url          VARCHAR(500),
                tenant_id         INT DEFAULT NULL,
                created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_req_reporter (reporter),
                INDEX idx_req_status   (internal_status),
                INDEX idx_req_created  (created_at),
                INDEX idx_req_tenant   (tenant_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await q(`
            CREATE TABLE IF NOT EXISTS kb_articles (
                id             CHAR(36)     NOT NULL PRIMARY KEY,
                tenant_id      INT UNSIGNED DEFAULT NULL,
                kb_category_id CHAR(36)     DEFAULT NULL,
                title          VARCHAR(255) NOT NULL,
                content        LONGTEXT     NOT NULL,
                excerpt        TEXT         DEFAULT NULL,
                tags           VARCHAR(500) DEFAULT NULL,
                author_id      CHAR(36)     NOT NULL,
                status         ENUM('borrador','publicado','archivado','revision','oculto') DEFAULT 'borrador',
                views          INT          DEFAULT 0,
                helpful_yes    INT          DEFAULT 0,
                helpful_no     INT          DEFAULT 0,
                created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
                updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at     DATETIME     DEFAULT NULL,
                INDEX idx_kb_status  (status),
                INDEX idx_kb_tenant  (tenant_id),
                INDEX idx_kb_author  (author_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        console.log('✅ Tablas de caché Jira y KB creadas');
    },

    async down(queryInterface) {
        const q = sql => queryInterface.sequelize.query(sql);
        await q('DROP TABLE IF EXISTS kb_articles');
        await q('DROP TABLE IF EXISTS ticket_history');
        await q('DROP TABLE IF EXISTS ticket_comments');
        await q('DROP TABLE IF EXISTS jira_requirements');
        await q('DROP TABLE IF EXISTS jira_tickets');
    },
};

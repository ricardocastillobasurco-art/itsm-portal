
const { dbQuery } = require('./helpers');
module.exports = function runMigrations() {
    (async () => {
    // Solo ejecutar si jira_tickets existe (tabla opcional — se crea cuando se configura Jira)
    const jiraExists = await dbQuery(`SHOW TABLES LIKE 'jira_tickets'`).then(r => r.length > 0).catch(() => false);

    try {
        if (!jiraExists) { /* tabla opcional — se crea al configurar Jira */ return; }
        const cols = await dbQuery(`SHOW COLUMNS FROM jira_tickets`);
        const existing = cols.map(c => c.Field);
        const migrations = [
            [`priority`,         `ALTER TABLE jira_tickets ADD COLUMN priority ENUM('P1','P2','P3','P4') DEFAULT 'P3' AFTER urgency_level`],
            [`internal_status`,  `ALTER TABLE jira_tickets ADD COLUMN internal_status ENUM('abierto','asignado','en_progreso','pendiente_usuario','resuelto','cerrado') DEFAULT 'abierto' AFTER status`],
            [`assigned_to`,      `ALTER TABLE jira_tickets ADD COLUMN assigned_to INT DEFAULT NULL AFTER internal_status`],
            [`assigned_to_name`, `ALTER TABLE jira_tickets ADD COLUMN assigned_to_name VARCHAR(100) DEFAULT NULL AFTER assigned_to`],
            [`assigned_at`,      `ALTER TABLE jira_tickets ADD COLUMN assigned_at DATETIME DEFAULT NULL AFTER assigned_to_name`],
            [`first_response_at`,`ALTER TABLE jira_tickets ADD COLUMN first_response_at DATETIME DEFAULT NULL AFTER assigned_at`],
            [`resolved_at`,      `ALTER TABLE jira_tickets ADD COLUMN resolved_at DATETIME DEFAULT NULL AFTER first_response_at`],
            [`resolution_note`,  `ALTER TABLE jira_tickets ADD COLUMN resolution_note TEXT DEFAULT NULL AFTER resolved_at`],
            [`sla_deadline`,     `ALTER TABLE jira_tickets ADD COLUMN sla_deadline DATETIME DEFAULT NULL AFTER resolution_note`],
            [`tipo_atencion`,    `ALTER TABLE jira_tickets ADD COLUMN tipo_atencion VARCHAR(30) DEFAULT NULL AFTER resolution_note`],
            [`closed_by`,          `ALTER TABLE jira_tickets ADD COLUMN closed_by VARCHAR(100) DEFAULT NULL AFTER closed_at`],
            [`close_comment`,      `ALTER TABLE jira_tickets ADD COLUMN close_comment TEXT DEFAULT NULL AFTER closed_by`],
            [`wp_resultado_padre`, `ALTER TABLE jira_tickets ADD COLUMN wp_resultado_padre VARCHAR(100) DEFAULT NULL AFTER close_comment`],
            [`wp_resultado_hijo`,  `ALTER TABLE jira_tickets ADD COLUMN wp_resultado_hijo VARCHAR(100) DEFAULT NULL AFTER wp_resultado_padre`],
            [`derived_to`,         `ALTER TABLE jira_tickets ADD COLUMN derived_to VARCHAR(100) DEFAULT NULL AFTER wp_resultado_hijo`],
            [`derived_at`,         `ALTER TABLE jira_tickets ADD COLUMN derived_at DATETIME DEFAULT NULL AFTER derived_to`],
            [`derived_by`,         `ALTER TABLE jira_tickets ADD COLUMN derived_by VARCHAR(100) DEFAULT NULL AFTER derived_at`],
            [`derived_note`,       `ALTER TABLE jira_tickets ADD COLUMN derived_note TEXT DEFAULT NULL AFTER derived_by`],
            [`tenant_id`,          `ALTER TABLE jira_tickets ADD COLUMN tenant_id INT DEFAULT NULL AFTER derived_note`],
        ];
        for (const [col, sql] of migrations) {
            if (!existing.includes(col)) {
                await dbQuery(sql);
                console.log(`✅ Columna añadida: ${col}`);
            }
        }
    } catch (e) {
        console.error('⚠️ Migración jira_tickets:', e.message);
    }

    // Índices de performance
    try {
        const idxChecks = [
            [`idx_jt_status`,          `CREATE INDEX idx_jt_status ON jira_tickets(internal_status)`],
            [`idx_jt_priority`,        `CREATE INDEX idx_jt_priority ON jira_tickets(priority)`],
            [`idx_jt_created`,         `CREATE INDEX idx_jt_created ON jira_tickets(created_at)`],
            [`idx_jt_assigned`,        `CREATE INDEX idx_jt_assigned ON jira_tickets(assigned_to)`],
            [`idx_jt_sla`,             `CREATE INDEX idx_jt_sla ON jira_tickets(sla_deadline)`],
        ];
        for (const [, sql] of idxChecks) {
            try { await dbQuery(sql); } catch(e) { /* ya existe */ }
        }
    } catch(e) {}

    // Tabla ticket_comments
    try {
        await dbQuery(`
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
    } catch(e) { console.error('⚠️ ticket_comments create:', e.message); }
    // Migrar ticket_comments si existe con FK incorrecta a tickets(id)
    try {
        const tcCols = await dbQuery(`SHOW COLUMNS FROM ticket_comments WHERE Field='ticket_id'`);
        if (tcCols.length && tcCols[0].Type.toLowerCase().includes('int')) {
            // Tiene ticket_id INT con FK antigua — eliminar FK y cambiar a VARCHAR
            const fks = await dbQuery(`
                SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_comments'
                  AND REFERENCED_TABLE_NAME IS NOT NULL
            `);
            for (const fk of fks) {
                try { await dbQuery(`ALTER TABLE ticket_comments DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``); } catch(_){}
            }
            await dbQuery(`ALTER TABLE ticket_comments MODIFY COLUMN ticket_id VARCHAR(50) NOT NULL`);
            console.log('✅ ticket_comments: ticket_id migrado a VARCHAR(50), FK removida');
        }
    } catch(e) { console.error('⚠️ ticket_comments migrate:', e.message); }

    // Tabla derive_teams — grupos configurables para derivación de tickets
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS derive_teams (
                id              INT PRIMARY KEY AUTO_INCREMENT,
                name            VARCHAR(100) NOT NULL,
                description     VARCHAR(255) DEFAULT NULL,
                icon            VARCHAR(50)  DEFAULT 'bi-people',
                color           VARCHAR(20)  DEFAULT '#6b7280',
                jira_option_id  VARCHAR(50)  DEFAULT NULL,
                is_active       TINYINT(1)   DEFAULT 1,
                sort_order      INT          DEFAULT 0,
                created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const existing = await dbQuery(`SELECT COUNT(*) as n FROM derive_teams`);
        if (!existing[0]?.n) {
            await dbQuery(`INSERT INTO derive_teams (name, description, icon, color, jira_option_id, sort_order) VALUES
                ('Accesos / Conectividad',      'Problemas de red, VPN o accesos al sistema', 'bi-hdd-network',      '#3b82f6', '11278', 1),
                ('Consultas Generales',          'Consultas no especializadas o informativas',  'bi-question-circle',  '#8b5cf6', '11279', 2),
                ('Seguridad Informática',        'Incidentes de seguridad o accesos no autorizados', 'bi-shield-lock', '#ef4444', NULL,    3),
                ('Infraestructura / Servidores', 'Problemas de servidores o infraestructura',  'bi-server',           '#10b981', NULL,    4),
                ('Gerencia / Supervisión',       'Escalar a supervisión o gerencia',           'bi-person-workspace', '#f59e0b', NULL,    5),
                ('Proveedor Externo',            'Escalar a proveedor o fabricante externo',   'bi-truck',            '#6b7280', NULL,    6)
            `);
            console.log('✅ derive_teams: datos iniciales cargados');
        }
    } catch(e) { console.error('⚠️ derive_teams:', e.message); }

    // Tabla ticket_history
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS ticket_history (
                id          INT PRIMARY KEY AUTO_INCREMENT,
                ticket_id   VARCHAR(50) NOT NULL,
                user_id     INT DEFAULT 0,
                user_name   VARCHAR(100) DEFAULT 'Sistema',
                evento      VARCHAR(50) NOT NULL,
                detalle     TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ticket (ticket_id),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.error('⚠️ ticket_history:', e.message); }

    // Tabla software_catalog
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS software_catalog (
                id          INT PRIMARY KEY AUTO_INCREMENT,
                nombre      VARCHAR(200) NOT NULL,
                version     VARCHAR(50)  DEFAULT NULL,
                fabricante  VARCHAR(100) DEFAULT NULL,
                activo      TINYINT(1)   DEFAULT 1,
                created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_nombre (nombre)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        // Seed inicial
        const existing_sw = await dbQuery(`SELECT COUNT(*) AS cnt FROM software_catalog`);
        if (!existing_sw[0]?.cnt) {
            await dbQuery(`INSERT INTO software_catalog (nombre, fabricante) VALUES
                ('Bizagi Modeler','Bizagi'),('Adobe Reader','Adobe'),
                ('Microsoft Office 2021','Microsoft'),('Microsoft Office 365','Microsoft'),
                ('Power BI Desktop','Microsoft'),('Visual Studio Code','Microsoft'),
                ('Visual Studio 2022','Microsoft'),('Google Chrome','Google'),
                ('Microsoft Teams','Microsoft'),('Zoom','Zoom Video'),
                ('AutoCAD','Autodesk'),('SAP','SAP'),
                ('VPN Client','Cisco'),('AnyDesk','AnyDesk'),
                ('TeamViewer','TeamViewer'),('7-Zip','Igor Pavlov'),
                ('WinRAR','RARLAB'),('Slack','Salesforce'),
                ('Outlook','Microsoft'),('OneDrive','Microsoft')`);
        }
    } catch(e) { console.error('⚠️ software_catalog:', e.message); }

    // Tabla itsm_automations
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS itsm_automations (
                id          INT PRIMARY KEY AUTO_INCREMENT,
                \`key\`     VARCHAR(100) NOT NULL UNIQUE,
                value       TEXT,
                updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const seeds = [
            ['p1_escalation_enabled', '0'],
            ['p1_escalation_email',   ''],
            ['p1_escalation_minutes', '30'],
            ['satisfaction_enabled',  '0'],
            ['sla_alert_enabled',     '0'],
            ['sla_alert_email',       ''],
            ['sla_alert_minutes',     '10'],
        ];
        for (const [k, v] of seeds) {
            await dbQuery(`INSERT IGNORE INTO itsm_automations (\`key\`, value) VALUES (?, ?)`, [k, v]);
        }
    } catch(e) { console.error('⚠️ itsm_automations:', e.message); }

    // Tabla itsm_surveys
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS itsm_surveys (
                id             INT PRIMARY KEY AUTO_INCREMENT,
                ticket_key     VARCHAR(50) NOT NULL,
                token          VARCHAR(100) NOT NULL UNIQUE,
                reporter_email VARCHAR(255),
                rating         INT DEFAULT NULL,
                comment        TEXT,
                sent_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
                responded_at   DATETIME DEFAULT NULL,
                INDEX idx_token (token),
                INDEX idx_ticket (ticket_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.error('⚠️ itsm_surveys:', e.message); }

    // Columna escalation_notified_at en jira_tickets
    if (jiraExists) try {
        const cols = await dbQuery(`SHOW COLUMNS FROM jira_tickets WHERE Field='escalation_notified_at'`);
        if (!cols.length) {
            await dbQuery(`ALTER TABLE jira_tickets ADD COLUMN escalation_notified_at DATETIME DEFAULT NULL`);
            console.log('✅ Columna escalation_notified_at añadida');
        }
    } catch(e) { console.error('⚠️ escalation_notified_at:', e.message); }

    // CMDB: device_code en jira_tickets
    if (jiraExists) try {
        const dcc = await dbQuery(`SHOW COLUMNS FROM jira_tickets WHERE Field='device_code'`);
        if (!dcc.length) {
            await dbQuery(`ALTER TABLE jira_tickets ADD COLUMN device_code VARCHAR(50) DEFAULT NULL AFTER reporter`);
            await dbQuery(`CREATE INDEX idx_jt_device ON jira_tickets(device_code)`).catch(()=>{});
            console.log('✅ Columna device_code añadida a jira_tickets');
        }
    } catch(e) { console.error('⚠️ device_code:', e.message); }

    // Asegurar que ENUM de role en users incluye los roles del ITSM
    try {
        await dbQuery(`
            ALTER TABLE users MODIFY COLUMN role
            ENUM('admin','agente','usuario','supervisor','administrador','especialista','visor','operador','superadmin')
            DEFAULT 'usuario'
        `);
        await dbQuery(`UPDATE users SET role='usuario' WHERE role='' OR role IS NULL`);
        console.log('✅ ENUM users.role actualizado y roles vacíos normalizados');
    } catch(e) { console.error('⚠️ ENUM users.role:', e.message); }

    // Tabla user_equipment — asignación de equipos para tenants multi-tenant (no usa tabla employees)
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS user_equipment (
                id              INT PRIMARY KEY AUTO_INCREMENT,
                user_id         INT NOT NULL,
                tenant_id       INT NOT NULL,
                device_code     VARCHAR(50)  NOT NULL,
                serial_number   VARCHAR(100) DEFAULT NULL,
                equipment_type  VARCHAR(50)  DEFAULT NULL,
                brand           VARCHAR(100) DEFAULT NULL,
                model           VARCHAR(200) DEFAULT NULL,
                department_name VARCHAR(200) DEFAULT NULL,
                location_name   VARCHAR(100) DEFAULT NULL,
                status          ENUM('Activo','Devuelto','Mantenimiento') DEFAULT 'Activo',
                assignment_date DATE DEFAULT NULL,
                return_date     DATE DEFAULT NULL,
                notes           TEXT DEFAULT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ue_user   (user_id),
                INDEX idx_ue_tenant (tenant_id),
                INDEX idx_ue_device (device_code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Seed: equipos de ejemplo para usuarios Petrotal (tenant_id = 5)
        const petrotalUsers = await dbQuery(
            `SELECT id, email, full_name FROM users WHERE tenant_id = 5 AND is_active = 1 AND deleted_at IS NULL LIMIT 20`
        );
        if (petrotalUsers.length) {
            const sampleEquip = [
                { device_code: 'PCG-PET-001', serial: 'SN-PET-2024-001', type: 'Laptop',  brand: 'Dell',   model: 'Latitude 5540',   dept: 'Tecnología de Información', loc: 'Lima - Sede Principal' },
                { device_code: 'PCG-PET-002', serial: 'SN-PET-2024-002', type: 'Laptop',  brand: 'HP',     model: 'EliteBook 840 G9', dept: 'Operaciones',               loc: 'Lima - Sede Principal' },
                { device_code: 'PCG-PET-003', serial: 'SN-PET-2024-003', type: 'Desktop', brand: 'Lenovo', model: 'ThinkCentre M90q', dept: 'Finanzas',                  loc: 'Lima - Sede Principal' },
            ];
            for (let i = 0; i < petrotalUsers.length; i++) {
                const u = petrotalUsers[i];
                const eq = sampleEquip[i % sampleEquip.length];
                const userDevCode = `${eq.device_code.slice(0,-1)}${(i+1).toString().padStart(2,'0')}`;
                const existing = await dbQuery(`SELECT id FROM user_equipment WHERE user_id = ? LIMIT 1`, [u.id]);
                if (!existing.length) {
                    await dbQuery(
                        `INSERT INTO user_equipment (user_id, tenant_id, device_code, serial_number, equipment_type, brand, model, department_name, location_name, assignment_date, status)
                         VALUES (?, 5, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 'Activo')`,
                        [u.id, userDevCode, eq.serial.replace('001', (i+1).toString().padStart(3,'0')), eq.type, eq.brand, eq.model, eq.dept, eq.loc]
                    );
                    console.log(`✅ user_equipment: equipo asignado a ${u.email}`);
                }
            }
        }
    } catch(e) { console.error('⚠️ user_equipment:', e.message); }
})();
};

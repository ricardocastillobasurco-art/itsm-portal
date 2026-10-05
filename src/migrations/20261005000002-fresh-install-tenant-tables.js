'use strict';

// Instalaciones nuevas (Azure, dedicadas, on-premise): algunas tablas por empresa
// solo quedaban completas porque la aplicación las ajustaba al arrancar, o porque
// la migración que agrega tenant_id corría ANTES de la que crea la tabla.
// Aquí se dejan completas desde las migraciones. En instalaciones existentes no
// cambia nada (todo ya existe). Idempotente.

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const tables = new Set(await queryInterface.showAllTables());

    // 1. sla_policies: tenant_id + única por (empresa, prioridad)
    if (tables.has('sla_policies')) {
      const cols = await queryInterface.describeTable('sla_policies');
      if (!cols.tenant_id) {
        await q('ALTER TABLE sla_policies ADD COLUMN tenant_id INT NOT NULL DEFAULT 1 AFTER id');
      }
      const [idx] = await q('SHOW INDEX FROM sla_policies');
      const names = new Set(idx.map(i => i.Key_name));
      if (names.has('prioridad')) await q('ALTER TABLE sla_policies DROP INDEX prioridad');
      if (!names.has('sla_policies_tenant_prioridad_unique')) {
        await q('ALTER TABLE sla_policies ADD UNIQUE KEY sla_policies_tenant_prioridad_unique (tenant_id, prioridad)');
      }
    }

    // 2. ticket_categories (antes la creaba routes/jira/admin.js al primer uso)
    if (!tables.has('ticket_categories')) {
      await q(`CREATE TABLE ticket_categories (
          id               INT PRIMARY KEY AUTO_INCREMENT,
          parent_id        INT          DEFAULT NULL,
          name             VARCHAR(255) NOT NULL,
          icon             VARCHAR(50)  DEFAULT 'bi-tag',
          component_id     VARCHAR(120),
          component_label  VARCHAR(100),
          app_id           VARCHAR(120),
          app_label        VARCHAR(100),
          tipologia_id     VARCHAR(120),
          tipologia_label  VARCHAR(100),
          impact_id        VARCHAR(20)  DEFAULT '618437',
          impact_label     VARCHAR(100),
          urgency_id       VARCHAR(20)  DEFAULT '618441',
          urgency_label    VARCHAR(100),
          description_template TEXT,
          sort_order       INT          DEFAULT 0,
          is_active        TINYINT      DEFAULT 1,
          tenant_id        INT          DEFAULT 1,
          created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_cat_parent (parent_id),
          INDEX idx_ticket_categories_tenant (tenant_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }

    // 3. kb_categories (secciones de la base de conocimiento)
    if (!tables.has('kb_categories')) {
      await q(`CREATE TABLE kb_categories (
          id          CHAR(36)     NOT NULL PRIMARY KEY,
          name        VARCHAR(100) NOT NULL,
          description TEXT NULL,
          icon        VARCHAR(50)  DEFAULT 'book',
          sort_order  INT NOT NULL DEFAULT 0,
          created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          tenant_id   INT DEFAULT 1,
          KEY idx_kb_categories_tenant_id (tenant_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  },
  async down() {},
};

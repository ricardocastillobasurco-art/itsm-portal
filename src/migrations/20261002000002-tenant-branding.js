'use strict';

// Marca por empresa desde la BD (BrandingService): nombre, logo, color, título
// del portal y nombre del equipo de soporte. La tabla tenant_view_overrides ya
// existía sin uso; se completan columnas y la empresa dueña conserva su imagen
// actual (logo y "Workplace IT") si es una instalación que ya los mostraba.
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
    const tables = new Set(await queryInterface.showAllTables());

    if (!tables.has('tenant_view_overrides')) {
      await q(`CREATE TABLE tenant_view_overrides (
                 id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                 tenant_id       INT NOT NULL,
                 company_name    VARCHAR(255) NULL,
                 logo_url        VARCHAR(500) NULL,
                 favicon_url     VARCHAR(500) NULL,
                 primary_color   VARCHAR(7)   NULL,
                 secondary_color VARCHAR(7)   NULL,
                 custom_css      TEXT NULL,
                 created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 UNIQUE KEY uq_tenant_view_overrides_tenant (tenant_id)
               ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    const cols = await queryInterface.describeTable('tenant_view_overrides');
    if (!cols.support_name) await q('ALTER TABLE tenant_view_overrides ADD COLUMN support_name VARCHAR(100) NULL');
    if (!cols.portal_title) await q('ALTER TABLE tenant_view_overrides ADD COLUMN portal_title VARCHAR(60) NULL');

    if (!tables.has('tenants')) return;
    const [[owner]] = await q("SELECT slug FROM tenants WHERE id = 1");
    if (!/integratel/i.test(owner?.slug || '')) return;
    const [[has]] = await q('SELECT COUNT(*) AS n FROM tenant_view_overrides WHERE tenant_id = 1');
    if (Number(has?.n) > 0) return;
    await q(`INSERT INTO tenant_view_overrides (tenant_id, logo_url, support_name, portal_title, created_at, updated_at)
             VALUES (1, '/images/movistar-logo.png', 'Workplace IT', 'WORKPLACE', NOW(), NOW())`);
  },
  async down() {},
};

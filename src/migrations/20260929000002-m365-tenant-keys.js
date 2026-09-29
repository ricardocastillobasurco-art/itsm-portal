'use strict';

// Claves de las tablas M365 por tenant: dos clientes pueden tener el mismo SKU
// o el mismo UPN (p. ej. cuentas de invitado). Idempotente.
//   m365_license_costs:  PRIMARY KEY (sku_name)      → (tenant_id, sku_name)
//   m365_user_licenses:  UNIQUE uk_upn (upn)         → uk_tenant_upn (tenant_id, upn)

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const tables = new Set(await queryInterface.showAllTables());
    const indexes = async (table) => (await q(`SHOW INDEX FROM \`${table}\``))[0];

    if (tables.has('m365_license_costs')) {
      const cols = await queryInterface.describeTable('m365_license_costs');
      const pk = (await indexes('m365_license_costs'))
        .filter(i => i.Key_name === 'PRIMARY').map(i => i.Column_name);
      if (cols.tenant_id && !pk.includes('tenant_id')) {
        await q('UPDATE m365_license_costs SET tenant_id = 1 WHERE tenant_id IS NULL');
        await q(`ALTER TABLE m365_license_costs
                   MODIFY tenant_id INT NOT NULL DEFAULT 1,
                   DROP PRIMARY KEY,
                   ADD PRIMARY KEY (tenant_id, sku_name)`);
      }
    }

    if (tables.has('m365_user_licenses')) {
      const cols = await queryInterface.describeTable('m365_user_licenses');
      const names = new Set((await indexes('m365_user_licenses')).map(i => i.Key_name));
      if (cols.tenant_id && !names.has('uk_tenant_upn')) {
        await q('UPDATE m365_user_licenses SET tenant_id = 1 WHERE tenant_id IS NULL');
        await q(`ALTER TABLE m365_user_licenses
                   MODIFY tenant_id INT NOT NULL DEFAULT 1,
                   ADD UNIQUE KEY uk_tenant_upn (tenant_id, upn)`);
      }
      if (names.has('uk_upn')) {
        await q('ALTER TABLE m365_user_licenses DROP INDEX uk_upn');
      }
    }
  },

  async down() {
    // No se revierte: volver a claves globales mezclaría datos de clientes.
  },
};

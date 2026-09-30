'use strict';

// Aislamiento por tenant a nivel de esquema. Idempotente.
//
// 1. Claves únicas globales → (tenant_id, columna): dos clientes pueden tener el
//    mismo departamento, CIP, código de equipo, intent del chatbot, etc. Con la
//    clave global, un "ON DUPLICATE KEY UPDATE" de un tenant pisaba la fila de otro
//    (itsm_automations) y los INSERT IGNORE por tenant se descartaban (faq_intents).
//    Se mantienen globales las claves que son secuencias o tokens globales
//    (ticket_key, req_key, change_number, problem_number, tokens de sesión/encuesta).
// 2. kb_search_log.tenant_id (lo usa /api/kb/no-results).
// 3. tenant_id NULL → 1 en todas las tablas (NULL siempre significó tenant 1), para
//    que los filtros exactos de Sequelize (tenantId = 1) vean las filas legacy.

const COMPOSITE = [
  // [tabla, índice global actual, columna]
  ['departments',               'uq_dept_name', 'department_name'],
  ['employees',                 'uq_cip',       'cip'],
  ['equipment',                 'uq_device',    'device_code'],
  ['faq_intents',               'intent_key',   'intent_key'],
  ['itsm_automations',          'key',          'key'],
  ['itsm_categories',           'nombre',       'nombre'],
  ['locations',                 'uq_branch',    'branch_office_id'],
  ['report_contacts',           'email',        'email'],
  ['report_distribution_lists', 'slug',         'slug'],
  ['sccm_inventory',            'uq_hostname',  'hostname'],
];

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const tables = new Set(await queryInterface.showAllTables());
    const indexNames = async (t) => new Set((await q(`SHOW INDEX FROM \`${t}\``))[0].map(i => i.Key_name));

    // 1. Claves compuestas
    for (const [table, oldIdx, col] of COMPOSITE) {
      if (!tables.has(table)) continue;
      const cols = await queryInterface.describeTable(table);
      if (!cols.tenant_id || !cols[col]) continue;
      const names = await indexNames(table);
      const newIdx = `uq_tenant_${col}`;
      await q(`UPDATE \`${table}\` SET tenant_id = 1 WHERE tenant_id IS NULL`);
      // NOT NULL: con NULL la clave compuesta no detecta duplicados
      await q(`ALTER TABLE \`${table}\` MODIFY tenant_id ${cols.tenant_id.type} NOT NULL DEFAULT 1`);
      if (!names.has(newIdx)) await q(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${newIdx}\` (tenant_id, \`${col}\`)`);
      if (names.has(oldIdx)) await q(`ALTER TABLE \`${table}\` DROP INDEX \`${oldIdx}\``);
    }

    // 2. kb_search_log.tenant_id
    if (tables.has('kb_search_log')) {
      const cols = await queryInterface.describeTable('kb_search_log');
      if (!cols.tenant_id) {
        await q('ALTER TABLE kb_search_log ADD COLUMN tenant_id INT NOT NULL DEFAULT 1, ADD INDEX idx_kb_search_tenant (tenant_id)');
      }
    }

    // 3. Backfill NULL → 1
    const [nullable] = await q(`
      SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema = DATABASE() AND column_name = 'tenant_id' AND is_nullable = 'YES'`);
    for (const { t } of nullable) {
      await q(`UPDATE \`${t}\` SET tenant_id = 1 WHERE tenant_id IS NULL`).catch(() => {});
    }
  },

  async down() {
    // Sin reversa: volver a claves globales rompería datos de varios tenants.
  },
};

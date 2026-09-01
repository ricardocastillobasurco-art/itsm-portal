'use strict';

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('sla_policies')) return;

    try { await queryInterface.removeIndex('sla_policies', 'prioridad'); } catch { /* ignore */ }
    try { await queryInterface.sequelize.query('ALTER TABLE sla_policies DROP INDEX prioridad'); } catch { /* ignore */ }

    await queryInterface.addIndex('sla_policies', ['tenant_id', 'prioridad'], {
      unique: true,
      name:   'sla_policies_tenant_prioridad_unique',
    }).catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sla_policies', 'sla_policies_tenant_prioridad_unique');
    await queryInterface.addIndex('sla_policies', ['prioridad'], { unique: true });
  },
};

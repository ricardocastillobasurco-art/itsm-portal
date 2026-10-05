'use strict';

// Asistente de configuración inicial (OnboardingService): las empresas que ya
// existían antes de esta versión quedan marcadas como configuradas, para que a
// sus administradores no se les abra el asistente. Solo las empresas nuevas lo ven.
// Idempotente.

module.exports = {
  async up(queryInterface) {
    const tables = new Set(await queryInterface.showAllTables());
    if (!tables.has('tenants') || !tables.has('itsm_automations')) return;
    const value = JSON.stringify({ completed_at: new Date().toISOString(), legacy: true });
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO itsm_automations (tenant_id, \`key\`, value)
       SELECT id, 'onboarding', ? FROM tenants`, { replacements: [value] });
  },
  async down() {},
};

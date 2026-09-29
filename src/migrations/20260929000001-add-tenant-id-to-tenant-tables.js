'use strict';

// Agrega tenant_id a todas las tablas con datos propios de cada cliente.
// Idempotente: si la tabla no existe o ya tiene tenant_id (p. ej. agregado a
// mano en Railway), se omite. Los registros existentes quedan en tenant 1.
// Las tablas hijas (ticket_comments, portal_post_*, etc.) se aíslan vía su padre.

const TABLES = [
  // Activos
  'employees', 'equipment', 'assignments', 'departments', 'locations',
  'equipment_maintenance', 'equipment_recoveries', 'equipment_faults',
  'equipment_loans', 'equipment_transfers', 'recoveries', 'warranty_records',
  'sccm_inventory', 'sccm_inventory_log',
  // Licencias Microsoft 365
  'm365_license_costs', 'm365_license_snapshots', 'm365_user_licenses', 'm365_sync_log',
  // Gestión de servicios
  'print_queue', 'print_queue_vip_users', 'itsm_categories', 'itsm_automations',
  'itsm_surveys', 'csi_initiatives', 'known_errors', 'problem_tickets',
  'change_tickets', 'derive_teams', 'jira_requirements', 'services',
  'service_categories', 'catalog_software', 'software_catalog',
  // Reportes
  'report_distribution_lists', 'report_contacts', 'report_jobs', 'dashboard_stats_cache',
  // Portal / base de conocimiento
  'kb_categories', 'kb_learning_resources', 'kb_procedures', 'kb_procedure_requests',
  'faq_intents', 'faq_synonyms', 'faq_triggers', 'faq_requests',
  'portal_banners', 'portal_devoluciones', 'portal_garantias',
  'portal_knowledge_contributions', 'portal_surveys_general', 'portal_user_questions',
  'portal_whatsapp_requests', 'portal_activity_log', 'notifications',
  'chatbot_analytics', 'chat_consultation_messages',
  // RMM
  'rmm_alerts', 'rmm_alert_rules', 'rmm_deploy_jobs', 'rmm_scripts',
  'rmm_script_collections', 'rmm_settings', 'rmm_software_catalog',
  // Auditoría
  'audit_log', 'audit_logs',
];

const indexName = (table) => `idx_${table}_tenant_id`.slice(0, 64);

module.exports = {
  TABLES,

  async up(queryInterface) {
    const existing = new Set(await queryInterface.showAllTables());

    for (const table of TABLES) {
      if (!existing.has(table)) continue;
      const cols = await queryInterface.describeTable(table).catch(() => null);
      if (!cols || cols.tenant_id) continue;

      await queryInterface.sequelize.query(
        `ALTER TABLE \`${table}\` ADD COLUMN tenant_id INT NULL DEFAULT 1`
      );
      await queryInterface.sequelize.query(
        `UPDATE \`${table}\` SET tenant_id = 1 WHERE tenant_id IS NULL`
      );
      await queryInterface.addIndex(table, ['tenant_id'], { name: indexName(table) })
        .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
    }
  },

  async down() {
    // No se revierte: otras partes del sistema (y Railway) ya dependen de tenant_id.
  },
};

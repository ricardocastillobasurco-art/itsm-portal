'use strict';

// Wraps addIndex to skip silently if index already exists (idempotent).
async function safeAddIndex(qi, table, fields, options) {
  try {
    await qi.addIndex(table, fields, options);
  } catch (err) {
    if (err.message && err.message.includes('Duplicate key name')) return;
    throw err;
  }
}

module.exports = {
  async up(queryInterface) {
    const add = (t, f, n) => safeAddIndex(queryInterface, t, f, { name: n });

    // ── tickets ──────────────────────────────────────────────
    await add('tickets', ['tenant_id', 'status'],     'idx_tickets_tenant_status');
    await add('tickets', ['tenant_id', 'created_at'], 'idx_tickets_tenant_created');
    await add('tickets', ['assigned_to'],              'idx_tickets_assigned_to');
    await add('tickets', ['sla_status'],               'idx_tickets_sla_status');

    // ── service_requests ─────────────────────────────────────
    await add('service_requests', ['tenant_id', 'status'],     'idx_sr_tenant_status');
    await add('service_requests', ['tenant_id', 'created_at'], 'idx_sr_tenant_created');
    await add('service_requests', ['requester_id'],            'idx_sr_requester');

    // ── changes ──────────────────────────────────────────────
    await add('changes', ['tenant_id', 'status'],     'idx_changes_tenant_status');
    await add('changes', ['tenant_id', 'created_at'], 'idx_changes_tenant_created');
    await add('changes', ['status', 'type'],          'idx_changes_status_type');

    // ── problems ─────────────────────────────────────────────
    await add('problems', ['tenant_id', 'status'],     'idx_problems_tenant_status');
    await add('problems', ['tenant_id', 'created_at'], 'idx_problems_tenant_created');
    await add('problems', ['priority'],                'idx_problems_priority');
  },

  async down(queryInterface) {
    const drop = (t, n) => queryInterface.removeIndex(t, n).catch(() => {});

    await drop('tickets',          'idx_tickets_tenant_status');
    await drop('tickets',          'idx_tickets_tenant_created');
    await drop('tickets',          'idx_tickets_assigned_to');
    await drop('tickets',          'idx_tickets_sla_status');
    await drop('service_requests', 'idx_sr_tenant_status');
    await drop('service_requests', 'idx_sr_tenant_created');
    await drop('service_requests', 'idx_sr_requester');
    await drop('changes',          'idx_changes_tenant_status');
    await drop('changes',          'idx_changes_tenant_created');
    await drop('changes',          'idx_changes_status_type');
    await drop('problems',         'idx_problems_tenant_status');
    await drop('problems',         'idx_problems_tenant_created');
    await drop('problems',         'idx_problems_priority');
  },
};

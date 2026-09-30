'use strict';

// Numeración de tickets por empresa: TK-<CODIGO>-0001 / RQ-<CODIGO>-0001.
// - tenants.ticket_code: código corto y único de la empresa (A-Z0-9, 2-8).
//   Se completa desde el slug para las empresas que no son la dueña; la empresa
//   dueña (1) conserva su numeración actual (TK-0001) hasta que se le asigne uno.
// - ticket_key_sequences.prefix admite prefijos con código (p. ej. "TK-ACME").
// Los tickets existentes conservan su número. Idempotente.

function codeFromSlug(slug, id) {
  const c = String(slug || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
  return c.length >= 2 ? c : `C${id}`;
}

module.exports = {
  codeFromSlug,
  async up(queryInterface) {
    const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
    const tables = new Set(await queryInterface.showAllTables());

    const cols = await queryInterface.describeTable('tenants');
    if (!cols.ticket_code) {
      await q('ALTER TABLE tenants ADD COLUMN ticket_code VARCHAR(10) NULL, ADD UNIQUE KEY uq_tenant_ticket_code (ticket_code)');
    }

    if (!tables.has('ticket_key_sequences')) {
      await q(`CREATE TABLE ticket_key_sequences (
                 prefix     VARCHAR(20) NOT NULL PRIMARY KEY,
                 last_value INT UNSIGNED NOT NULL DEFAULT 0
               ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } else {
      await q('ALTER TABLE ticket_key_sequences MODIFY prefix VARCHAR(20) NOT NULL');
    }

    const [rows] = await q('SELECT id, slug FROM tenants WHERE id <> 1 AND ticket_code IS NULL ORDER BY id');
    const [taken] = await q('SELECT ticket_code FROM tenants WHERE ticket_code IS NOT NULL');
    const used = new Set(taken.map(r => r.ticket_code));
    for (const t of rows) {
      const base = codeFromSlug(t.slug, t.id);
      let code = base, n = 2;
      while (used.has(code)) code = `${base.slice(0, 6)}${n++}`;
      used.add(code);
      await q('UPDATE tenants SET ticket_code = ? WHERE id = ?', [code, t.id]);
    }
  },
  async down() {},
};

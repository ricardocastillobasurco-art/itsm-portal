'use strict';

// ADD COLUMN IF NOT EXISTS is MariaDB-only; use .catch(()=>{}) for MySQL 8 compat.
// A failing ADD COLUMN means the column already exists — safe to ignore.

module.exports = {
  async up(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql);

    // ── ticket_surveys — required by TicketSurvey Sequelize model ────────────
    await q(`
      CREATE TABLE IF NOT EXISTS ticket_surveys (
        id         INT          AUTO_INCREMENT PRIMARY KEY,
        ticket_id  CHAR(36)     NOT NULL,
        user_id    CHAR(36)     NOT NULL,
        rating     TINYINT      NOT NULL,
        comment    TEXT         NULL,
        skipped    TINYINT(1)   NOT NULL DEFAULT 0,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ticket (ticket_id),
        KEY idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── portal_devoluciones — columns added later via IIFE fail on MySQL 8 ──
    await q(`ALTER TABLE portal_devoluciones ADD COLUMN status           VARCHAR(20)  NOT NULL DEFAULT 'pendiente'`).catch(() => {});
    await q(`ALTER TABLE portal_devoluciones ADD COLUMN foto_data        LONGTEXT`).catch(() => {});
    await q(`ALTER TABLE portal_devoluciones ADD COLUMN entrego_mochila  TINYINT(1)   NOT NULL DEFAULT 0`).catch(() => {});

    // ── portal_announcements — tenant_id not in original CREATE TABLE ────────
    await q(`ALTER TABLE portal_announcements ADD COLUMN tenant_id INT NOT NULL DEFAULT 1`).catch(() => {});

    // ── faq_items — tenant_id not in original CREATE TABLE ───────────────────
    await q(`ALTER TABLE faq_items ADD COLUMN tenant_id INT NOT NULL DEFAULT 1`).catch(() => {});

    // ── portal_knowledge_contributions — admin_response ──────────────────────
    await q(`ALTER TABLE portal_knowledge_contributions ADD COLUMN admin_response TEXT NULL`).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ticket_surveys');
    // Column removals omitted — reverting structural changes is risky and unnecessary
  },
};

'use strict';

// chat_consultations.specialist_id was INT but users.id is UUID (VARCHAR(36)).
// Storing a UUID in INT causes "Data truncated" → 500 on POST /consult/:id/take.
// Also adds satisfaction_rating column if not already present (the IIFE used
// 'ADD COLUMN IF NOT EXISTS' which is MariaDB-only and fails silently on MySQL 8).
module.exports = {
  async up(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql).catch(() => {});
    await q(`ALTER TABLE chat_consultations MODIFY specialist_id VARCHAR(36) NULL`);
    await q(`ALTER TABLE chat_consultations ADD COLUMN satisfaction_rating TINYINT NULL`);
  },
  async down(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql).catch(() => {});
    await q(`ALTER TABLE chat_consultations MODIFY specialist_id INT NULL`);
    await q(`ALTER TABLE chat_consultations DROP COLUMN satisfaction_rating`);
  },
};

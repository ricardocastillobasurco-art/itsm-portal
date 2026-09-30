'use strict';

// Soporte para la gestión local de tickets (sin Jira). Idempotente.
//
// 1. ticket_comments.tipo admite 'interno': antes el valor no existía en el ENUM,
//    las notas internas se guardaban con tipo vacío y se mostraban al usuario final.
//    Las filas con tipo vacío se marcan como 'interno' (no se sabe si eran públicas:
//    es más seguro ocultarlas al usuario que exponerlas).
// 2. sla_paused_at en incidencias y requerimientos: el SLA se congela mientras el
//    ticket espera al usuario (pendiente_usuario) y se extiende al reanudarse.

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const tables = new Set(await queryInterface.showAllTables());

    if (tables.has('ticket_comments')) {
      const [[col]] = await q("SHOW COLUMNS FROM ticket_comments LIKE 'tipo'");
      if (col && !String(col.Type).includes("'interno'")) {
        await q(`ALTER TABLE ticket_comments MODIFY tipo
                 ENUM('comentario','cambio_estado','asignacion','sistema','interno') NOT NULL DEFAULT 'comentario'`);
      }
      await q("UPDATE ticket_comments SET tipo = 'interno' WHERE tipo = ''");
    }

    for (const t of ['jira_tickets', 'jira_requirements']) {
      if (!tables.has(t)) continue;
      const cols = await queryInterface.describeTable(t);
      if (!cols.sla_paused_at) await q(`ALTER TABLE \`${t}\` ADD COLUMN sla_paused_at DATETIME NULL`);
    }
  },
  async down() {},
};

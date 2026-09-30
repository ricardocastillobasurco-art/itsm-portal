'use strict';

// El login resuelve la empresa de un correo por tenants.domain. Antes el código
// tenía fijo el dominio del tenant dueño; ahora se registra en la tabla.
// Si el tenant 1 no tiene dominio, se toma el dominio corporativo más usado por
// sus usuarios (se ignoran dominios de correo público). Idempotente.

const PUBLIC = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'live.com', 'icloud.com', 'plataforma.local', 'sistema.local'];

module.exports = {
  async up(queryInterface) {
    const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
    const [[t1]] = await q('SELECT id, domain FROM tenants WHERE id = 1');
    if (!t1 || t1.domain) return;
    const [rows] = await q(`
      SELECT LOWER(SUBSTRING_INDEX(email, '@', -1)) AS d, COUNT(*) AS n
      FROM users
      WHERE COALESCE(tenant_id, 1) = 1 AND email LIKE '%@%' AND role <> 'superadmin'
      GROUP BY d ORDER BY n DESC`);
    const best = rows.find(r => r.d && !PUBLIC.includes(r.d));
    if (!best) return;
    const [[taken]] = await q('SELECT id FROM tenants WHERE LOWER(domain) = ? LIMIT 1', [best.d]);
    if (!taken) await q('UPDATE tenants SET domain = ? WHERE id = 1', [best.d]);
  },
  async down() {},
};

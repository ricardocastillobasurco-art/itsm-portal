'use strict';

// Invalida la contraseña conocida de las cuentas demo que sembraba
// 20260917000005 (usuarios *.pt del tenant demo). No borra datos: las
// cuentas quedan con una contraseña aleatoria que nadie conoce; si se usan,
// se recuperan con "¿Olvidaste tu contraseña?".

const crypto = require('crypto');
const bcrypt = require('bcrypt');

module.exports = {
  async up(queryInterface) {
    const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
    const [cols] = await q(`SHOW COLUMNS FROM users LIKE 'password_hash'`);
    const passCol = cols.length ? 'password_hash' : 'password';
    const [users] = await q(`SELECT id FROM users WHERE username LIKE '%.pt' AND email LIKE '%@petrotal-corp.com'`);
    for (const { id } of users) {
      const hash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10);
      await q(`UPDATE users SET ${passCol} = ? WHERE id = ?`, [hash, id]);
    }
  },
  async down() {},
};

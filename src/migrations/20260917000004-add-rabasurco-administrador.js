'use strict';
const { v4: uuidv4 } = require('uuid');

// Promueve a administrador al usuario indicado por ADMIN_BOOTSTRAP_EMAIL.
// Si no existe, lo crea usando ADMIN_BOOTSTRAP_PASS y ADMIN_BOOTSTRAP_NAME.
// Configurar en Railway → Variables de entorno:
//   ADMIN_BOOTSTRAP_EMAIL=rabasurco@petrotal-corp.com
//   ADMIN_BOOTSTRAP_PASS=<contraseña temporal>
//   ADMIN_BOOTSTRAP_NAME=Ricardo Basurco   (opcional)
module.exports = {
    async up(queryInterface) {
        const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
        if (!email) return;

        const q = (sql, params) => queryInterface.sequelize.query(sql, { replacements: params });
        const [rows] = await q(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);

        if (rows.length) {
            await q(
                `UPDATE users SET role = 'administrador', is_active = 1, deleted_at = NULL WHERE email = ?`,
                [email]
            );
        } else {
            const pass = process.env.ADMIN_BOOTSTRAP_PASS;
            if (!pass) { console.warn('⚠️ ADMIN_BOOTSTRAP_PASS no definida, no se creó el usuario.'); return; }
            const bcrypt = require('bcrypt');
            const hash   = await bcrypt.hash(pass, 10);
            const [[col]] = await queryInterface.sequelize.query(`SHOW COLUMNS FROM users LIKE 'password_hash'`);
            const passCol  = col ? 'password_hash' : 'password';
            const name     = process.env.ADMIN_BOOTSTRAP_NAME || email.split('@')[0];
            const username = email.split('@')[0];
            await q(
                `INSERT INTO users (id, full_name, username, email, ${passCol}, role, is_active, is_verified, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'administrador', 1, 1, NOW(), NOW())`,
                [uuidv4(), name, username, email, hash]
            );
        }
    },
    async down() {},
};

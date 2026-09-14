'use strict';

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const EMAIL    = 'miguel.canchari@integratel.com.pe';
const USERNAME = 'miguel.canchari';
const FULLNAME = 'Miguel Canchari';
const PASSWORD = 'Integratel@2024!'; // temporal — cambiar tras primer login

module.exports = {
    async up(queryInterface) {
        const [existing] = await queryInterface.sequelize.query(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            { replacements: [EMAIL], type: 'SELECT' }
        );

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        if (existing) {
            await queryInterface.sequelize.query(
                `UPDATE users SET role = 'administrador', is_active = 1, updated_at = ? WHERE email = ?`,
                { replacements: [now, EMAIL] }
            );
            console.log(`  ✅ Usuario actualizado a administrador → ${EMAIL}`);
            return;
        }

        const passwordHash = await bcrypt.hash(PASSWORD, 12);
        await queryInterface.sequelize.query(
            `INSERT INTO users (id, username, full_name, email, password_hash, role, is_active, is_verified, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'administrador', 1, 1, ?, ?)`,
            { replacements: [uuidv4(), USERNAME, FULLNAME, EMAIL, passwordHash, now, now] }
        );
        console.log(`  ✅ Usuario creado como administrador → ${EMAIL}`);
        console.log(`  🔑 Contraseña temporal: ${PASSWORD}`);
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            `UPDATE users SET role = 'usuario' WHERE email = ?`,
            { replacements: [EMAIL] }
        );
    },
};

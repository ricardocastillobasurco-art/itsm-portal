'use strict';

// ============================================================================
// Seeder 003 — Usuario Super Admin de Plataforma
//
// Este usuario NO pertenece a ningún tenant (tenant_id = NULL).
// Tiene acceso exclusivo a /superadmin y puede ver todos los tenants.
//
// Credenciales (configurar en .env antes de producción):
//   SUPERADMIN_EMAIL    = superadmin@plataforma.local
//   SUPERADMIN_PASSWORD = SuperAdmin@2026!
// ============================================================================

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const EMAIL    = process.env.SUPERADMIN_EMAIL    || 'superadmin@plataforma.local';
const PASSWORD = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@2026!';
const USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';

module.exports = {
    async up(queryInterface) {
        const [existing] = await queryInterface.sequelize.query(
            'SELECT id FROM users WHERE email = ? OR role = ? LIMIT 1',
            { replacements: [EMAIL, 'superadmin'], type: 'SELECT' }
        );

        if (existing) {
            console.log(`  ⚠️  Superadmin ya existe, se omite`);
            return;
        }

        const hash = await bcrypt.hash(PASSWORD, 12);
        const now  = new Date().toISOString().slice(0, 19).replace('T', ' ');

        await queryInterface.sequelize.query(
            `INSERT INTO users (id, username, full_name, email, password_hash, role, tenant_id, is_active, is_verified, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'superadmin', NULL, 1, 1, ?, ?)`,
            { replacements: [uuidv4(), USERNAME, 'Super Administrador de Plataforma', EMAIL, hash, now, now] }
        );

        console.log(`  ✅ Superadmin creado → ${EMAIL}`);
        console.log(`  🔑 Password: ${PASSWORD}`);
        console.log(`  ⚠️  Configura SUPERADMIN_PASSWORD en .env antes de producción`);
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            "DELETE FROM users WHERE role = 'superadmin'",
        );
    },
};

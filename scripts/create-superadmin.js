/**
 * scripts/create-superadmin.js
 *
 * Crea el usuario superadmin directamente en la BD.
 * No requiere Sequelize CLI — solo Node.js.
 *
 * Uso:
 *   node scripts/create-superadmin.js
 */

'use strict';

require('dotenv').config();
const mysql  = require('mysql2/promise');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const EMAIL    = process.env.SUPERADMIN_EMAIL    || 'superadmin@plataforma.local';
const PASSWORD = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@2026!';
const USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';

async function main() {
    const pool = await mysql.createConnection({
        host:     process.env.EQUIPMENT_HOST     || 'localhost',
        port:     parseInt(process.env.EQUIPMENT_PORT || '3306'),
        user:     process.env.EQUIPMENT_USER     || 'root',
        password: process.env.EQUIPMENT_PASSWORD || '',
        database: process.env.EQUIPMENT_DATABASE || 'equipment_management',
    });

    console.log('🔌 Conectado a la BD');

    // ─── 1. Ampliar ENUM si falta 'superadmin' ─────────────────────────────
    try {
        await pool.execute(`
            ALTER TABLE users
            MODIFY COLUMN role ENUM(
                'admin','agente','usuario','supervisor',
                'administrador','especialista','tecnico','superadmin'
            ) NOT NULL DEFAULT 'usuario'
        `);
        console.log('✅ ENUM de role actualizado');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️  ENUM ya estaba actualizado');
        } else {
            console.log('⚠️  ALTER ENUM:', e.message);
        }
    }

    // ─── 2. Añadir tenant_id si no existe ──────────────────────────────────
    try {
        await pool.execute(`
            ALTER TABLE users ADD COLUMN tenant_id INT NULL DEFAULT NULL AFTER role
        `);
        console.log('✅ Columna tenant_id añadida');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️  Columna tenant_id ya existía');
        } else {
            console.log('⚠️  ALTER tenant_id:', e.message);
        }
    }

    // ─── 3. Verificar si ya existe el usuario por email ────────────────────
    const [rows] = await pool.execute(
        'SELECT id, role FROM users WHERE email = ? OR username = ? LIMIT 1',
        [EMAIL, USERNAME]
    );

    if (rows.length > 0) {
        const existing = rows[0];
        if (existing.role === 'superadmin') {
            console.log('ℹ️  El usuario ya tiene role superadmin. Nada que hacer.');
            await pool.end();
            return;
        }
        // Existe pero con rol incorrecto — lo corrige
        await pool.execute(
            "UPDATE users SET role = 'superadmin', tenant_id = NULL WHERE id = ?",
            [existing.id]
        );
        console.log('✅ Role corregido a superadmin para el usuario existente');
        console.log('   Email:    ', EMAIL);
        console.log('   Password: ', PASSWORD);
        await pool.end();
        return;
    }

    // ─── 4. Crear usuario nuevo ─────────────────────────────────────────────
    const hash = await bcrypt.hash(PASSWORD, 12);
    const id   = uuidv4();
    const now  = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await pool.execute(
        `INSERT INTO users
            (id, username, full_name, email, password_hash, role, tenant_id, is_active, is_verified, created_at, updated_at)
         VALUES (?, ?, 'Super Administrador de Plataforma', ?, ?, 'superadmin', NULL, 1, 1, ?, ?)`,
        [id, USERNAME, EMAIL, hash, now, now]
    );

    console.log('');
    console.log('✅ ─────────────────────────────────────────────');
    console.log('   Usuario superadmin creado exitosamente');
    console.log('   Email:    ', EMAIL);
    console.log('   Password: ', PASSWORD);
    console.log('   URL:       /superadmin');
    console.log('   ─────────────────────────────────────────────');
    console.log('');
    console.log('⚠️  Cambia SUPERADMIN_PASSWORD en .env antes de pasar a producción');

    await pool.end();
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});

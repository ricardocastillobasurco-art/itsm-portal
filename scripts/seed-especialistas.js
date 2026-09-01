'use strict';
require('dotenv').config();
const bcrypt = require('bcrypt');
const { dbQuery } = require('../routes/jira/helpers');

const SPECIALISTS = [
    { full_name: 'Carlos Mendoza Torres',  username: 'cmendoza',   email: 'cmendoza@itsm.local',   specialty: 'Redes y Conectividad' },
    { full_name: 'Ana Lucía Ríos Vega',    username: 'alrios',     email: 'alrios@itsm.local',     specialty: 'Hardware y Equipos' },
    { full_name: 'Diego Fernández Cruz',   username: 'dfernandez', email: 'dfernandez@itsm.local', specialty: 'Software y Aplicaciones' },
];

async function main() {
    // Obtener el max id ignorando el row del superadmin (que tiene INT_MAX)
    const [maxRow] = await dbQuery(`SELECT MAX(id) AS mx FROM users WHERE id < 200000`);
    let nextId = Number(maxRow?.mx || 104) + 1;
    console.log(`Próximo id a usar: ${nextId}`);

    for (const s of SPECIALISTS) {
        const existing = await dbQuery('SELECT id FROM users WHERE email=? OR username=? LIMIT 1', [s.email, s.username]);
        if (existing.length) { console.log(`⏭  Ya existe: ${s.full_name} (id=${existing[0].id})`); continue; }
        const hash = await bcrypt.hash('Especialista@2026!', 12);
        await dbQuery(
            `INSERT INTO users (id, full_name, username, email, password_hash, role, specialty, is_active, is_verified, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'especialista', ?, 1, 1, NOW(), NOW())`,
            [nextId, s.full_name, s.username, s.email, hash, s.specialty]
        );
        console.log(`✅ Creado: ${s.full_name} (${s.email}) id=${nextId} — pass: Especialista@2026!`);
        nextId++;
    }

    // Resetear AUTO_INCREMENT a un valor seguro
    await dbQuery(`ALTER TABLE users AUTO_INCREMENT = ${nextId}`);
    console.log(`✅ AUTO_INCREMENT actualizado a ${nextId}`);
    process.exit(0);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });

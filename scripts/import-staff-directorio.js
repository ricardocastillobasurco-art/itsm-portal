/**
 * Importa el directorio de personal (CELULAR;CIP;USUARIO) a la tabla staff_directorio.
 * Uso: node scripts/import-staff-directorio.js [ruta/al/archivo.csv]
 * Por defecto lee: data/staff.csv
 */
'use strict';
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CSV_PATH = process.argv[2] || path.join(__dirname, '../data/staff.csv');

const INVALID_PHONES = [
    '-', 'no desea', 'no debe', 'no debe contar'
];

function cleanPhone(raw) {
    const v = (raw || '').trim();
    if (!v) return null;
    const lower = v.toLowerCase();
    if (INVALID_PHONES.some(x => lower.startsWith(x))) return null;
    return /^\d{7,12}$/.test(v) ? v : null;
}

async function main() {
    if (!fs.existsSync(CSV_PATH)) {
        console.error('❌ Archivo no encontrado:', CSV_PATH);
        console.error('   Guarda el CSV como data/staff.csv o pasa la ruta como argumento.');
        process.exit(1);
    }

    const conn = await mysql.createConnection({
        host    : process.env.EQUIPMENT_HOST     || 'localhost',
        user    : process.env.EQUIPMENT_USER     || 'root',
        password: process.env.EQUIPMENT_PASSWORD || '',
        database: process.env.EQUIPMENT_DATABASE || 'equipment_management',
        charset : 'utf8mb4',
    });

    // Crear tabla si no existe
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS staff_directorio (
            id      INT AUTO_INCREMENT PRIMARY KEY,
            celular VARCHAR(30)  NULL,
            cip     VARCHAR(20)  NULL,
            nombre  VARCHAR(250) NOT NULL,
            INDEX idx_nombre (nombre(100)),
            INDEX idx_cip    (cip)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute('TRUNCATE TABLE staff_directorio');

    const content = fs.readFileSync(CSV_PATH, 'utf8');
    const lines   = content.replace(/\r/g, '').split('\n');

    let inserted = 0, skipped = 0;

    // Lote de 500 para INSERT rápido
    const BATCH = 500;
    let batch = [];

    const flush = async () => {
        if (!batch.length) return;
        const placeholders = batch.map(() => '(?,?,?)').join(',');
        const values = batch.flat();
        await conn.execute(
            `INSERT INTO staff_directorio (celular, cip, nombre) VALUES ${placeholders}`,
            values
        );
        inserted += batch.length;
        batch = [];
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts  = line.split(';');
        if (parts.length < 3) { skipped++; continue; }

        const [celularRaw, cipRaw, nombreRaw] = parts;
        const nombre  = (nombreRaw || '').trim();
        if (!nombre || nombre.length < 3) { skipped++; continue; }

        const celular = cleanPhone(celularRaw);
        const cip     = (cipRaw || '').trim() || null;

        batch.push([celular, cip, nombre]);
        if (batch.length >= BATCH) await flush();
    }

    await flush();
    await conn.end();

    console.log(`✅ staff_directorio: ${inserted} registros importados, ${skipped} omitidos.`);
    console.log('   Puedes volver a ejecutar este script para actualizar el directorio.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });

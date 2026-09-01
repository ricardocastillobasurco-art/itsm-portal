/**
 * inject_xlsx.js — Inyectar/actualizar desde Excel sin duplicados
 * Upsert: departments · locations · employees · equipment · assignments
 * Crea columnas nuevas automáticamente si no existen en la BD
 *
 * Uso: node scripts/inject_xlsx.js scripts/27-04.xlsx
 */

const XLSX  = require('xlsx');
const mysql = require('mysql2/promise');
const path  = require('path');
require('dotenv').config();

const DB = {
    host:     process.env.EQUIPMENT_HOST     || 'localhost',
    port:     parseInt(process.env.EQUIPMENT_PORT) || 3306,
    user:     process.env.EQUIPMENT_USER     || 'ricardo',
    password: process.env.EQUIPMENT_PASSWORD || 'Misbubus6',
    database: process.env.EQUIPMENT_DATABASE || 'equipment_management',
};

// ── helpers ────────────────────────────────────────────────────────────────
const v = x => (x !== undefined && x !== null && String(x).trim() !== '') ? String(x).trim() : null;

// CIP puede venir como "45930.0" (float de Excel) → "45930"
const cleanCip = s => {
    if (!s) return null;
    const f = parseFloat(String(s));
    return isNaN(f) ? String(s).trim() : String(Math.round(f));
};

const isSinEquipo = s =>
    !s || ['sin equipo', '-', 'n/a', 'na', ''].includes(String(s).trim().toLowerCase());

const mapEqType = s => {
    if (!s) return 'Laptop';
    const l = s.toLowerCase();
    if (l.includes('ultraligera') || l.includes('ultra'))  return 'Ultraligera';
    if (l.includes('portatil') || l.includes('laptop') || l.includes('portátil')) return 'Laptop';
    if (l.includes('desktop') || l.includes('pc'))         return 'Desktop';
    if (l.includes('tablet'))                               return 'Tablet';
    if (l.includes('smartphone') || l.includes('celular'))  return 'Smartphone';
    if (l.includes('monitor'))                              return 'Monitor';
    return 'Otro';
};

const mapAcqType = s => {
    if (!s) return 'Propio';
    const l = s.toLowerCase();
    if (l.includes('compra') || l.includes('propio'))     return 'Propio';
    if (l.includes('arrend') || l.includes('renting'))    return 'Arrendado';
    if (l.includes('leasing'))                            return 'Leasing';
    if (l.includes('donado'))                             return 'Donado';
    return 'Propio';
};

const mapEmpGroup = s => {
    if (!s) return 'EMP';
    const u = s.trim().toUpperCase();
    if (u === 'EJC') return 'EJC';
    if (u === 'EMP') return 'EMP';
    return 'OTROS';
};

const mapStatus = s => {
    if (!s) return 'Disponible';
    const l = s.toLowerCase();
    if (l.includes('asignado'))                              return 'Asignado';
    if (l.includes('disponib'))                              return 'Disponible';
    if (l.includes('reparac'))                               return 'En Reparación';
    if (l.includes('baja'))                                  return 'Dado de Baja';
    if (l.includes('transito') || l.includes('tránsito'))    return 'En Tránsito';
    return 'Disponible';
};

// Extrae marca del modelo (primer token): "HP EliteBook…" → "HP"
const extractBrand = model => (model ? model.split(/\s+/)[0] : '') || '';

// ── upsert genérico ────────────────────────────────────────────────────────
async function upsert(conn, table, data, updateCols) {
    const cols = Object.keys(data).filter(k => data[k] !== undefined);
    const vals = cols.map(k => data[k]);
    const upd  = updateCols.map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(', ');
    const sql  = `INSERT INTO \`${table}\` (\`${cols.join('`,`')}\`)
                  VALUES (${cols.map(() => '?').join(',')})
                  ON DUPLICATE KEY UPDATE ${upd}`;
    const [r] = await conn.execute(sql, vals);
    return r;
}

// ── schema: añadir columnas y UNIQUE keys que puedan faltar ───────────────
async function migrateSchema(conn) {
    const alters = [
        `ALTER TABLE departments ADD COLUMN IF NOT EXISTS desc_ceo_8  VARCHAR(255) DEFAULT NULL`,
        `ALTER TABLE departments ADD COLUMN IF NOT EXISTS desc_ceo_9  VARCHAR(255) DEFAULT NULL`,
        `ALTER TABLE departments ADD COLUMN IF NOT EXISTS desc_ceo_10 VARCHAR(255) DEFAULT NULL`,
        `ALTER TABLE employees   ADD COLUMN IF NOT EXISTS cost_center VARCHAR(100) DEFAULT NULL`,
        `ALTER TABLE employees   ADD COLUMN IF NOT EXISTS birthdate   DATE         DEFAULT NULL`,
        `ALTER TABLE employees   ADD COLUMN IF NOT EXISTS id_ssff     VARCHAR(50)  DEFAULT NULL`,
    ];
    for (const sql of alters) {
        await conn.execute(sql).catch(e => console.warn(`  ⚠ schema: ${e.message}`));
    }

    const uniques = [
        `ALTER TABLE departments ADD UNIQUE KEY IF NOT EXISTS uq_dept_name (department_name)`,
        `ALTER TABLE locations   ADD UNIQUE KEY IF NOT EXISTS uq_branch    (branch_office_id)`,
        `ALTER TABLE employees   ADD UNIQUE KEY IF NOT EXISTS uq_cip       (cip)`,
        `ALTER TABLE equipment   ADD UNIQUE KEY IF NOT EXISTS uq_device    (device_code)`,
    ];
    for (const sql of uniques) {
        await conn.execute(sql).catch(() => {});
    }
    console.log('   ✅ Schema OK\n');
}

// ── caches en memoria (evita SELECTs repetidos) ───────────────────────────
const cacheDept = new Map();
const cacheLoc  = new Map();

async function getDeptId(conn, row) {
    const name = v(row.department_name);
    if (!name) return null;
    if (cacheDept.has(name)) return cacheDept.get(name);

    await upsert(conn, 'departments', {
        department_name: name,
        division:        v(row.division),
        subactivity:     v(row.subactivity),
        desc_ceo:        v(row.desc_ceo),
        desc_ceo_1:      v(row.desc_ceo_1),
        desc_ceo_2:      v(row.desc_ceo_2),
        desc_ceo_3:      v(row.desc_ceo_3),
        desc_ceo_4:      v(row.desc_ceo_4),
        desc_ceo_5:      v(row.desc_ceo_5),
        desc_ceo_6:      v(row.desc_ceo_6),
        desc_ceo_7:      v(row.desc_ceo_7),
        desc_ceo_8:      v(row.desc_ceo_8),
        desc_ceo_9:      v(row.desc_ceo_9),
        desc_ceo_10:     v(row.desc_ceo_10),
        is_active:       1,
    }, ['division','subactivity',
        'desc_ceo','desc_ceo_1','desc_ceo_2','desc_ceo_3','desc_ceo_4',
        'desc_ceo_5','desc_ceo_6','desc_ceo_7','desc_ceo_8','desc_ceo_9','desc_ceo_10']);

    const [[dept]] = await conn.execute(
        'SELECT id FROM departments WHERE department_name=? LIMIT 1', [name]
    );
    cacheDept.set(name, dept.id);
    return dept.id;
}

async function getLocId(conn, row) {
    const branch = v(row.branch_office_id);
    if (!branch) return null;
    if (cacheLoc.has(branch)) return cacheLoc.get(branch);

    await upsert(conn, 'locations', {
        branch_office_id: branch,
        location_name:    branch,
        city:             v(row.state) || branch,
        state:            v(row.state),
        country:          'Perú',
        is_active:        1,
    }, ['location_name', 'city', 'state']);

    const [[loc]] = await conn.execute(
        'SELECT id FROM locations WHERE branch_office_id=? LIMIT 1', [branch]
    );
    cacheLoc.set(branch, loc.id);
    return loc.id;
}

// ── procesar una fila ──────────────────────────────────────────────────────
async function processRow(conn, row) {
    const cip        = cleanCip(v(row.cip));
    const rawDevice  = v(row['Equipo Asignado']);
    const deviceCode = isSinEquipo(rawDevice) ? null : rawDevice;

    if (!cip && !deviceCode) return 'skip';

    const deptId = await getDeptId(conn, row);
    const locId  = await getLocId(conn, row);

    // ── employee ──────────────────────────────────────────────────────────
    if (cip) {
        await upsert(conn, 'employees', {
            cip:              cip,
            national_id:      v(row.national_id) || cip,
            document_type:    v(row.document_type) || 'DNI',
            full_name:        v(row.full_name) || '',
            email:            v(row.email) || '',
            network_account:  v(row['Cta de red']),
            position_name:    v(row.position_name),
            category:         v(row.category),
            employee_group:   mapEmpGroup(v(row.employee_group)),
            legal_entity:     v(row.legal_entity) || 'T. PERU',
            branch_office_id: v(row.branch_office_id),
            state:            v(row.state),
            supervisor_name:  v(row.supervisor_name),
            department_id:    deptId,
            id_ssff:          v(row.id_ssff),
            cost_center:      v(row.cost_center),
            birthdate:        v(row.birthdate) || null,
            is_active:        1,
        }, ['full_name','email','network_account','position_name','category',
            'employee_group','legal_entity','branch_office_id','state',
            'supervisor_name','department_id','id_ssff','cost_center','birthdate']);
    }

    if (!deviceCode) return cip ? 'emp_only' : 'skip';

    // ── equipment ─────────────────────────────────────────────────────────
    const model  = v(row.Modelo) || '';
    const brand  = extractBrand(model);
    const anoRaw = v(row['AÑO']);
    const ano    = (anoRaw && !isNaN(parseInt(anoRaw))) ? parseInt(anoRaw) : null;

    await upsert(conn, 'equipment', {
        device_code:        deviceCode,
        serial_number:      deviceCode,   // Excel no trae S/N — usar device_code
        model:              model,
        brand:              brand,
        equipment_type:     mapEqType(v(row.TIPO)),
        acquisition_type:   mapAcqType(v(row['Tipo de adquision'])),
        obsolescence_years: ano,
        status:             mapStatus(v(row.Estado)),
    }, ['model','brand','equipment_type','acquisition_type','obsolescence_years','status']);

    if (!cip) return 'eqp_only';

    // ── assignment ────────────────────────────────────────────────────────
    const [[empRow]] = await conn.execute(
        'SELECT id FROM employees WHERE cip=? LIMIT 1', [cip]
    );
    const [[eqpRow]] = await conn.execute(
        'SELECT id FROM equipment WHERE device_code=? LIMIT 1', [deviceCode]
    );
    if (!empRow || !eqpRow) return 'skip';

    const [existing] = await conn.execute(
        `SELECT id FROM assignments
         WHERE employee_id=? AND equipment_id=? AND status='Activo' LIMIT 1`,
        [empRow.id, eqpRow.id]
    );

    if (!existing.length) {
        await conn.execute(
            `INSERT INTO assignments
               (employee_id, equipment_id, department_id, location_id,
                period, assignment_date, relation_type, status)
             VALUES (?,?,?,?,?,CURDATE(),?,'Activo')`,
            [empRow.id, eqpRow.id, deptId, locId,
             v(row.period) || '202602',
             v(row.Relacionado) || 'Equipo Unico']
        );
        // marcar equipo como Asignado
        await conn.execute(
            `UPDATE equipment SET status='Asignado' WHERE id=?`, [eqpRow.id]
        );
    }

    return 'assign';
}

// ── limpiar tablas ─────────────────────────────────────────────────────────
async function cleanTables(conn) {
    console.log('🗑️  Limpiando tablas...');
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['assignments', 'equipment', 'employees', 'locations', 'departments']) {
        await conn.execute(`TRUNCATE TABLE \`${t}\``);
        console.log(`   ✅ ${t} → vacía`);
    }
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('   🔑 FK checks restaurados\n');
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
    const args     = process.argv.slice(2);
    const doClean  = args.includes('--clean');
    const xlsxPath = args.find(a => !a.startsWith('--'));

    if (!xlsxPath) {
        console.error('❌  Uso: node scripts/inject_xlsx.js <archivo.xlsx> [--clean]');
        process.exit(1);
    }

    const absPath = path.resolve(xlsxPath);
    console.log('\n' + '═'.repeat(60));
    console.log('📊  INJECT XLSX → equipment_management');
    console.log('═'.repeat(60));
    console.log(`📄  Archivo : ${absPath}`);

    const wb   = XLSX.readFile(absPath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);  // primera fila = headers

    console.log(`📑  Hoja    : ${wb.SheetNames[0]}`);
    console.log(`🔢  Filas   : ${rows.length}\n`);

    if (!rows.length) { console.error('❌  Archivo vacío'); process.exit(1); }

    const conn = await mysql.createConnection(DB);
    console.log('✅  BD conectada:', DB.database, '\n');

    if (doClean) await cleanTables(conn);

    console.log('🔧  Migrando schema...');
    await migrateSchema(conn);

    const stats = { assign: 0, emp_only: 0, eqp_only: 0, skip: 0, error: 0 };
    const errDetails = [];

    for (let i = 0; i < rows.length; i++) {
        try {
            const result = await processRow(conn, rows[i]);
            stats[result]++;
        } catch (err) {
            stats.error++;
            if (errDetails.length < 15) {
                errDetails.push({
                    fila:   i + 2,
                    cip:    v(rows[i].cip) || '—',
                    equipo: v(rows[i]['Equipo Asignado']) || '—',
                    error:  err.message,
                });
            }
        }

        if ((i + 1) % 500 === 0) {
            process.stdout.write(`  ⏳ ${i + 1}/${rows.length} procesadas...\r`);
        }
    }

    await conn.end();

    console.log('\n' + '═'.repeat(60));
    console.log('📋  RESULTADO FINAL');
    console.log('═'.repeat(60));
    console.log(`  ✅  Empleado + equipo + asignación : ${stats.assign}`);
    console.log(`  👤  Solo empleado (sin equipo)     : ${stats.emp_only}`);
    console.log(`  📦  Solo equipo (almacén)          : ${stats.eqp_only}`);
    console.log(`  ⏭️   Filas omitidas                 : ${stats.skip}`);
    console.log(`  ❌  Errores                        : ${stats.error}`);

    if (errDetails.length) {
        console.log('\n⚠️  PRIMEROS ERRORES:');
        console.log('─'.repeat(60));
        errDetails.forEach(e =>
            console.log(`  Fila ${String(e.fila).padStart(4)} │ CIP ${String(e.cip).padEnd(12)} │ ${e.equipo} │ ${e.error}`)
        );
    }

    console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(err => {
    console.error('\n❌  Fatal:', err.message);
    process.exit(1);
});

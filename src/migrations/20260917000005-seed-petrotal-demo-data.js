'use strict';
const { v4: uuidv4 } = require('uuid');

// Datos demo para Petrotal. Envuelto en try/catch para que un fallo
// no crashee la app — solo emite un warning y continúa.
module.exports = {
    async up(queryInterface) {
        try {
            await _run(queryInterface);
        } catch (e) {
            console.warn('⚠️  Demo Petrotal seed falló (no crítico):', e.message);
        }
    },
    async down(queryInterface) {
        const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
        await q(`DELETE FROM jira_tickets WHERE ticket_key LIKE 'TK-P%'`, []).catch(() => {});
        await q(`DELETE FROM users WHERE username LIKE '%.pt'`, []).catch(() => {});
    },
};

async function _run(queryInterface) {
    const seq = queryInterface.sequelize;
    // raw query helper — devuelve [rows, meta]
    const q  = (sql, p) => seq.query(sql, { replacements: p });
    // select helper — devuelve solo rows[]
    const qs = async (sql, p) => { const [rows] = await seq.query(sql, { replacements: p }); return rows; };

    // ── 0. Buscar/crear tenant Petrotal por slug (no por id hardcodeado) ──────
    let tenantRows = await qs(`SELECT id FROM tenants WHERE slug='petrotal' LIMIT 1`);
    let TENANT;

    if (tenantRows.length) {
        TENANT = tenantRows[0].id;
    } else {
        await q(`INSERT INTO tenants (slug, name, plan, domain, contact_email, is_active, created_at, updated_at)
                 VALUES ('petrotal','Petrotal','enterprise','petrotal-corp.com','it@petrotal-corp.com',1,NOW(),NOW())`);
        const [newRows] = await seq.query(`SELECT LAST_INSERT_ID() AS id`);
        TENANT = newRows[0].id;
    }

    // ── Guard: evitar re-seed ──────────────────────────────────────────────────
    const check = await qs(`SELECT id FROM jira_tickets WHERE ticket_key LIKE 'TK-P%' AND tenant_id=? LIMIT 1`, [TENANT]);
    if (check.length) { console.log('ℹ️  Demo Petrotal ya existe, se omite.'); return; }

    // ── 1. Equipo TI Petrotal ─────────────────────────────────────────────────
    const bcrypt = require('bcrypt');
    const hash   = await bcrypt.hash('Demo.Petrotal2026!', 10);
    const now    = new Date();
    const [colRows] = await seq.query(`SHOW COLUMNS FROM users LIKE 'password_hash'`);
    const passCol   = colRows.length ? 'password_hash' : 'password';

    const staff = [
        { username: 'cmendoza.pt', full_name: 'Carlos Mendoza', email: 'cmendoza@petrotal-corp.com', specialty: 'Hardware',  role: 'especialista' },
        { username: 'mtorres.pt',  full_name: 'María Torres',   email: 'mtorres@petrotal-corp.com',  specialty: 'Software',  role: 'administrador' },
        { username: 'jquispe.pt',  full_name: 'José Quispe',    email: 'jquispe@petrotal-corp.com',  specialty: 'Redes',     role: 'especialista' },
        { username: 'aflores.pt',  full_name: 'Ana Flores',     email: 'aflores@petrotal-corp.com',  specialty: 'ERP',       role: 'especialista' },
        { username: 'lhuanca.pt',  full_name: 'Luis Huanca',    email: 'lhuanca@petrotal-corp.com',  specialty: 'Hardware',  role: 'tecnico' },
    ];

    const ids = {};
    for (const u of staff) {
        const existing = await qs(`SELECT id FROM users WHERE email=? LIMIT 1`, [u.email]);
        if (existing.length) {
            ids[u.username] = existing[0].id;
        } else {
            const uid = uuidv4();
            await q(
                `INSERT INTO users (id,username,full_name,email,${passCol},role,specialty,tenant_id,is_active,is_verified,created_at,updated_at)
                 VALUES (?,?,?,?,?,?,?,?,1,1,?,?)`,
                [uid, u.username, u.full_name, u.email, hash, u.role, u.specialty, TENANT, now, now]
            );
            ids[u.username] = uid;
        }
    }

    const cm = { id: ids['cmendoza.pt'], name: 'Carlos Mendoza' };
    const jq = { id: ids['jquispe.pt'],  name: 'José Quispe'    };
    const af = { id: ids['aflores.pt'],  name: 'Ana Flores'     };

    // ── 2. Categorías ITSM ────────────────────────────────────────────────────
    const catCheck = await qs(`SELECT id FROM itsm_categories WHERE tenant_id=? LIMIT 1`, [TENANT]);
    if (!catCheck.length) {
        const cats = [
            ['Soporte en Campo',           'Incidencias en plataformas y pozos', 'bi-geo-alt-fill',    '#f59e0b'],
            ['Infraestructura y Redes',    'Servidores, switches y conectividad', 'bi-hdd-network',    '#3b82f6'],
            ['ERP / SAP',                  'Módulos SAP, accesos y reportes',    'bi-bar-chart-fill', '#8b5cf6'],
            ['Comunicaciones Satelitales', 'VSAT, radio y videoconferencia',     'bi-broadcast',      '#10b981'],
            ['Seguridad y Accesos',        'VPN, credenciales, Active Directory','bi-shield-lock-fill','#ef4444'],
            ['Equipos y Periféricos',      'Laptops, impresoras, monitores',     'bi-laptop',         '#6366f1'],
        ];
        for (const [name, desc, icon, color] of cats) {
            await q(
                `INSERT INTO itsm_categories (name,description,icon,color,tenant_id,is_active,created_at,updated_at)
                 VALUES (?,?,?,?,?,1,NOW(),NOW())`,
                [name, desc, icon, color, TENANT]
            ).catch(() => {});
        }
    }

    // ── 3. Tickets demo ───────────────────────────────────────────────────────
    const d = dias => { const f = new Date(); f.setDate(f.getDate() - dias); return f; };
    const s = (dias, h) => { const f = d(dias); f.setHours(f.getHours() + h); return f; };

    const tickets = [
        // Abiertos
        { key:'TK-P001', summary:'PC no enciende en sala de control - Lote 95',         pri:'P2', st:'abierto',           rep:'jperez@petrotal-corp.com',    comp:'Equipos y Periféricos',       cr:d(0),  ato:null, atn:null,    sla:s(0,4)  },
        { key:'TK-P002', summary:'Sin acceso a SAP módulo MM — usuario bloqueado',       pri:'P2', st:'abierto',           rep:'lsanchez@petrotal-corp.com',  comp:'ERP / SAP',                   cr:d(0),  ato:null, atn:null,    sla:s(0,4)  },
        { key:'TK-P003', summary:'Impresora HP no imprime en oficina Lima',              pri:'P4', st:'abierto',           rep:'rflores@petrotal-corp.com',   comp:'Equipos y Periféricos',       cr:d(1),  ato:null, atn:null,    sla:s(1,8)  },
        // Asignados
        { key:'TK-P004', summary:'VSAT sin señal — Campamento Norte Lote 131',           pri:'P1', st:'asignado',          rep:'gcasas@petrotal-corp.com',    comp:'Comunicaciones Satelitales',  cr:d(1),  ato:jq.id, atn:jq.name, sla:s(1,2),  aa:d(1) },
        { key:'TK-P005', summary:'Laptop con pantalla rota — Geólogo de campo',         pri:'P3', st:'asignado',          rep:'mrojas@petrotal-corp.com',    comp:'Equipos y Periféricos',       cr:d(2),  ato:cm.id, atn:cm.name, sla:s(2,8),  aa:d(2) },
        { key:'TK-P006', summary:'VPN no conecta desde hotel Lima',                     pri:'P3', st:'asignado',          rep:'ctapia@petrotal-corp.com',    comp:'Seguridad y Accesos',         cr:d(2),  ato:jq.id, atn:jq.name, sla:s(2,4),  aa:d(2) },
        // En progreso
        { key:'TK-P007', summary:'Servidor de archivos lento — oficina Iquitos',        pri:'P2', st:'en_progreso',       rep:'atorres@petrotal-corp.com',   comp:'Infraestructura y Redes',     cr:d(3),  ato:jq.id, atn:jq.name, sla:s(3,4),  aa:d(3), fra:d(3) },
        { key:'TK-P008', summary:'Reporte SAP-BW no genera datos del mes anterior',     pri:'P2', st:'en_progreso',       rep:'phuerta@petrotal-corp.com',   comp:'ERP / SAP',                   cr:d(3),  ato:af.id, atn:af.name, sla:s(3,8),  aa:d(3), fra:d(3) },
        { key:'TK-P009', summary:'Switch de red caído en sala de operaciones',          pri:'P1', st:'en_progreso',       rep:'elopez@petrotal-corp.com',    comp:'Infraestructura y Redes',     cr:d(4),  ato:jq.id, atn:jq.name, sla:s(4,2),  aa:d(4), fra:d(4) },
        { key:'TK-P010', summary:'Correo corporativo no envía adjuntos >10MB',          pri:'P3', st:'en_progreso',       rep:'bvidal@petrotal-corp.com',    comp:'Comunicaciones Satelitales',  cr:d(4),  ato:cm.id, atn:cm.name, sla:s(4,8),  aa:d(4), fra:d(4) },
        // Pendiente usuario
        { key:'TK-P011', summary:'Instalar AutoCAD 2024 en laptop de ingeniería',       pri:'P4', st:'pendiente_usuario', rep:'dchavez@petrotal-corp.com',   comp:'Equipos y Periféricos',       cr:d(5),  ato:cm.id, atn:cm.name, sla:s(5,8),  aa:d(5), fra:d(5) },
        { key:'TK-P012', summary:'Acceso a portal de proveedores — nuevo usuario',      pri:'P3', st:'pendiente_usuario', rep:'nquintero@petrotal-corp.com', comp:'Seguridad y Accesos',         cr:d(6),  ato:af.id, atn:af.name, sla:s(6,4),  aa:d(6), fra:d(6) },
        // Resueltos
        { key:'TK-P013', summary:'Password expirado en Windows — oficina Lima',         pri:'P4', st:'resuelto',          rep:'vcardenas@petrotal-corp.com', comp:'Seguridad y Accesos',         cr:d(7),  ato:cm.id, atn:cm.name, sla:s(7,4),  aa:d(7), fra:d(7), ra:d(6),  rn:'Contraseña restablecida vía AD y acceso validado.' },
        { key:'TK-P014', summary:'Monitor sin imagen — sala de reuniones Iquitos',      pri:'P3', st:'resuelto',          rep:'amontoya@petrotal-corp.com',  comp:'Equipos y Periféricos',       cr:d(8),  ato:cm.id, atn:cm.name, sla:s(8,8),  aa:d(8), fra:d(8), ra:d(7),  rn:'Cable HDMI defectuoso reemplazado.' },
        { key:'TK-P015', summary:'SAP: error al contabilizar factura proveedor',        pri:'P2', st:'resuelto',          rep:'smorales@petrotal-corp.com',  comp:'ERP / SAP',                   cr:d(9),  ato:af.id, atn:af.name, sla:s(9,4),  aa:d(9), fra:d(9), ra:d(8),  rn:'Cuenta contable corregida con equipo FI.' },
        { key:'TK-P016', summary:'Videoconferencia HQ — sin audio en sala ejecutiva',   pri:'P2', st:'resuelto',          rep:'rberrios@petrotal-corp.com',  comp:'Comunicaciones Satelitales',  cr:d(10), ato:jq.id, atn:jq.name, sla:s(10,4), aa:d(10),fra:d(10),ra:d(9),  rn:'Driver de audio actualizado y equipo reiniciado.' },
        { key:'TK-P017', summary:'Backup no ejecutó el fin de semana — servidor SCADA', pri:'P1', st:'resuelto',          rep:'jortega@petrotal-corp.com',   comp:'Infraestructura y Redes',     cr:d(12), ato:jq.id, atn:jq.name, sla:s(12,2), aa:d(12),fra:d(12),ra:d(11), rn:'Tarea de backup reconfigurada y validada manualmente.' },
        // Cerrados
        { key:'TK-P018', summary:'Teclado y mouse inalámbrico sin funcionar',           pri:'P4', st:'cerrado', rep:'icastro@petrotal-corp.com',   comp:'Equipos y Periféricos',      cr:d(15), ato:cm.id, atn:cm.name, sla:s(15,8), aa:d(15),fra:d(15),ra:d(14), rn:'Pilas reemplazadas. Receptor USB reubicado.',            ca:d(13), cc:'Confirmado por usuario.' },
        { key:'TK-P019', summary:'Creación de cuenta SAP para analista de contratos',   pri:'P3', st:'cerrado', rep:'pvasquez@petrotal-corp.com',  comp:'ERP / SAP',                  cr:d(18), ato:af.id, atn:af.name, sla:s(18,8), aa:d(18),fra:d(18),ra:d(17), rn:'Usuario creado con roles básicos SD/MM.',               ca:d(16), cc:'Acceso validado. Cerrado.' },
        { key:'TK-P020', summary:'Red wifi lenta en área administrativa Lima',           pri:'P3', st:'cerrado', rep:'ovalencia@petrotal-corp.com', comp:'Infraestructura y Redes',    cr:d(20), ato:jq.id, atn:jq.name, sla:s(20,4), aa:d(20),fra:d(20),ra:d(19), rn:'Canal WiFi cambiado a 5GHz y QoS configurado.',        ca:d(18), cc:'Velocidad normalizada. Cerrado.' },
        { key:'TK-P021', summary:'Laptop sin carga de batería — Geofísica',             pri:'P3', st:'cerrado', rep:'fquiroga@petrotal-corp.com',  comp:'Equipos y Periféricos',      cr:d(22), ato:cm.id, atn:cm.name, sla:s(22,8), aa:d(22),fra:d(22),ra:d(21), rn:'Cargador defectuoso reemplazado por activo en stock.',  ca:d(20), cc:'Cerrado por usuario.' },
        { key:'TK-P022', summary:'VPN bloqueada por antivirus corporativo',             pri:'P2', st:'cerrado', rep:'hmedina@petrotal-corp.com',   comp:'Seguridad y Accesos',        cr:d(25), ato:jq.id, atn:jq.name, sla:s(25,4), aa:d(25),fra:d(25),ra:d(24), rn:'Exclusión agregada en policy de antivirus.',            ca:d(23), cc:'VPN conecta correctamente. Cerrado.' },
        { key:'TK-P023', summary:'Error de impresión en facturación — SAP',             pri:'P2', st:'cerrado', rep:'kpacheco@petrotal-corp.com',  comp:'ERP / SAP',                  cr:d(28), ato:af.id, atn:af.name, sla:s(28,4), aa:d(28),fra:d(28),ra:d(27), rn:'Driver de impresora actualizado en servidor SAP.',      ca:d(26), cc:'Impresión validada en producción. Cerrado.' },
    ];

    for (const t of tickets) {
        await q(
            `INSERT INTO jira_tickets
             (ticket_key,summary,reporter,component,priority,internal_status,status,
              assigned_to,assigned_to_name,assigned_at,first_response_at,resolved_at,
              resolution_note,closed_at,close_comment,sla_deadline,tenant_id,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                t.key, t.summary, t.rep, t.comp,
                t.pri, t.st, t.st === 'abierto' ? 'Abierto' : t.st,
                t.ato||null, t.atn||null,
                t.aa||null, t.fra||null,
                t.ra||null, t.rn||null,
                t.ca||null, t.cc||null,
                t.sla||null, TENANT, t.cr, t.cr,
            ]
        ).catch(e => console.warn(`⚠️ skip ${t.key}: ${e.message}`));
    }

    console.log(`✅ Demo Petrotal (tenant ${TENANT}): ${staff.length} usuarios + ${tickets.length} tickets`);
}

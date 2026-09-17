'use strict';
const { v4: uuidv4 } = require('uuid');

// Datos demo para Petrotal (tenant_id=5).
// Solo corre si aún no existen tickets TK-P* (evita re-seed).
module.exports = {
    async up(queryInterface) {
        const q  = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
        const qr = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p, type: 'SELECT' });

        const TENANT = 5;
        const CHECK  = await qr(`SELECT id FROM jira_tickets WHERE ticket_key LIKE 'TK-P%' AND tenant_id=? LIMIT 1`, [TENANT]);
        if (CHECK.length) { console.log('ℹ️  Demo Petrotal ya existe, se omite.'); return; }

        // ── 1. Equipo TI Petrotal ─────────────────────────────────────────────
        const bcrypt = require('bcrypt');
        const hash   = await bcrypt.hash('Demo.Petrotal2026!', 10);
        const now    = new Date();
        const [[col]] = await queryInterface.sequelize.query(`SHOW COLUMNS FROM users LIKE 'password_hash'`);
        const passCol = col ? 'password_hash' : 'password';

        const staff = [
            { id: uuidv4(), username: 'cmendoza.pt',  full_name: 'Carlos Mendoza',   email: 'cmendoza@petrotal-corp.com',  specialty: 'Hardware',  role: 'especialista' },
            { id: uuidv4(), username: 'mtorres.pt',   full_name: 'María Torres',      email: 'mtorres@petrotal-corp.com',   specialty: 'Software',  role: 'administrador' },
            { id: uuidv4(), username: 'jquispe.pt',   full_name: 'José Quispe',       email: 'jquispe@petrotal-corp.com',   specialty: 'Redes',     role: 'especialista' },
            { id: uuidv4(), username: 'aflores.pt',   full_name: 'Ana Flores',        email: 'aflores@petrotal-corp.com',   specialty: 'ERP',       role: 'especialista' },
            { id: uuidv4(), username: 'lhuanca.pt',   full_name: 'Luis Huanca',       email: 'lhuanca@petrotal-corp.com',   specialty: 'Hardware',  role: 'tecnico' },
        ];

        for (const u of staff) {
            const exists = await qr(`SELECT id FROM users WHERE email=? LIMIT 1`, [u.email]);
            if (!exists.length) {
                await q(
                    `INSERT INTO users (id, username, full_name, email, ${passCol}, role, specialty, tenant_id, is_active, is_verified, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
                    [u.id, u.username, u.full_name, u.email, hash, u.role, u.specialty, TENANT, now, now]
                );
            } else {
                staff.find(s => s.email === u.email).id = exists[0].id;
            }
        }

        const cm = staff[0]; // Carlos Mendoza
        const jq = staff[2]; // José Quispe
        const af = staff[3]; // Ana Flores

        // ── 2. Categorías ITSM para Petrotal ─────────────────────────────────
        const catCheck = await qr(`SELECT id FROM itsm_categories WHERE tenant_id=? LIMIT 1`, [TENANT]);
        if (!catCheck.length) {
            const cats = [
                ['Soporte en Campo',            'Incidencias en plataformas y pozos', 'bi-geo-alt-fill', '#f59e0b'],
                ['Infraestructura y Redes',     'Servidores, switches y conectividad', 'bi-hdd-network', '#3b82f6'],
                ['ERP / SAP',                   'Módulos SAP, accesos y reportes',    'bi-bar-chart-fill', '#8b5cf6'],
                ['Comunicaciones Satelitales',  'VSAT, radio y videoconferencia',     'bi-broadcast',  '#10b981'],
                ['Seguridad y Accesos',         'VPN, credenciales, Active Directory', 'bi-shield-lock-fill', '#ef4444'],
                ['Equipos y Periféricos',       'Laptops, impresoras, monitores',     'bi-laptop',     '#6366f1'],
            ];
            for (const [name, desc, icon, color] of cats) {
                await q(
                    `INSERT INTO itsm_categories (name, description, icon, color, tenant_id, is_active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                    [name, desc, icon, color, TENANT]
                ).catch(() => {});
            }
        }

        // ── 3. Tickets demo ───────────────────────────────────────────────────
        const d = (dias) => {
            const f = new Date(); f.setDate(f.getDate() - dias); return f;
        };
        const sla = (dias, horas) => {
            const f = d(dias); f.setHours(f.getHours() + horas); return f;
        };

        const tickets = [
            // Abiertos
            { key:'TK-P001', summary:'PC no enciende en sala de control - Lote 95',        priority:'P2', status:'abierto',           reporter:'jperez@petrotal-corp.com',     phone:'945123001', component:'Equipos y Periféricos',        created:d(0),  assigned_to:null,    assigned_to_name:null,        sla_deadline:sla(0,4) },
            { key:'TK-P002', summary:'Sin acceso a SAP módulo MM — usuario bloqueado',      priority:'P2', status:'abierto',           reporter:'lsanchez@petrotal-corp.com',   phone:'945123002', component:'ERP / SAP',                    created:d(0),  assigned_to:null,    assigned_to_name:null,        sla_deadline:sla(0,4) },
            { key:'TK-P003', summary:'Impresora HP no imprime en oficina Lima',             priority:'P4', status:'abierto',           reporter:'rflores@petrotal-corp.com',    phone:'945123003', component:'Equipos y Periféricos',        created:d(1),  assigned_to:null,    assigned_to_name:null,        sla_deadline:sla(1,8) },
            // Asignados
            { key:'TK-P004', summary:'VSAT sin señal — Campamento Norte Lote 131',         priority:'P1', status:'asignado',          reporter:'gcasas@petrotal-corp.com',     phone:'945123004', component:'Comunicaciones Satelitales',   created:d(1),  assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(1,2), assigned_at:d(1) },
            { key:'TK-P005', summary:'Laptop con pantalla rota — Geólogo de campo',        priority:'P3', status:'asignado',          reporter:'mrojas@petrotal-corp.com',     phone:'945123005', component:'Equipos y Periféricos',        created:d(2),  assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(2,8), assigned_at:d(2) },
            { key:'TK-P006', summary:'VPN no conecta desde hotel Lima',                    priority:'P3', status:'asignado',          reporter:'ctapia@petrotal-corp.com',     phone:'945123006', component:'Seguridad y Accesos',          created:d(2),  assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(2,4), assigned_at:d(2) },
            // En progreso
            { key:'TK-P007', summary:'Servidor de archivos lento — oficina Iquitos',       priority:'P2', status:'en_progreso',       reporter:'atorres@petrotal-corp.com',    phone:'945123007', component:'Infraestructura y Redes',      created:d(3),  assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(3,4), assigned_at:d(3), first_response_at:d(3) },
            { key:'TK-P008', summary:'Reporte SAP-BW no genera datos del mes anterior',    priority:'P2', status:'en_progreso',       reporter:'phuerta@petrotal-corp.com',    phone:'945123008', component:'ERP / SAP',                    created:d(3),  assigned_to:af.id,   assigned_to_name:af.full_name, sla_deadline:sla(3,8), assigned_at:d(3), first_response_at:d(3) },
            { key:'TK-P009', summary:'Switch de red caído en sala de operaciones',         priority:'P1', status:'en_progreso',       reporter:'elopez@petrotal-corp.com',     phone:'945123009', component:'Infraestructura y Redes',      created:d(4),  assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(4,2), assigned_at:d(4), first_response_at:d(4) },
            { key:'TK-P010', summary:'Correo corporativo no envía adjuntos >10MB',         priority:'P3', status:'en_progreso',       reporter:'bvidal@petrotal-corp.com',     phone:'945123010', component:'Comunicaciones Satelitales',   created:d(4),  assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(4,8), assigned_at:d(4), first_response_at:d(4) },
            // Pendiente usuario
            { key:'TK-P011', summary:'Instalar AutoCAD 2024 en laptop de ingeniería',      priority:'P4', status:'pendiente_usuario', reporter:'dchavez@petrotal-corp.com',    phone:'945123011', component:'Equipos y Periféricos',        created:d(5),  assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(5,8), assigned_at:d(5), first_response_at:d(5) },
            { key:'TK-P012', summary:'Acceso a portal de proveedores — nuevo usuario',     priority:'P3', status:'pendiente_usuario', reporter:'nquintero@petrotal-corp.com',  phone:'945123012', component:'Seguridad y Accesos',          created:d(6),  assigned_to:af.id,   assigned_to_name:af.full_name, sla_deadline:sla(6,4), assigned_at:d(6), first_response_at:d(6) },
            // Resueltos
            { key:'TK-P013', summary:'Password expirado en Windows — oficina Lima',        priority:'P4', status:'resuelto',          reporter:'vcardenas@petrotal-corp.com',  phone:'945123013', component:'Seguridad y Accesos',          created:d(7),  assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(7,4), assigned_at:d(7), first_response_at:d(7), resolved_at:d(6), resolution_note:'Se restableció contraseña vía AD y se validó acceso.' },
            { key:'TK-P014', summary:'Monitor sin imagen — sala de reuniones Iquitos',     priority:'P3', status:'resuelto',          reporter:'amontoya@petrotal-corp.com',   phone:'945123014', component:'Equipos y Periféricos',        created:d(8),  assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(8,8), assigned_at:d(8), first_response_at:d(8), resolved_at:d(7), resolution_note:'Cable HDMI defectuoso reemplazado.' },
            { key:'TK-P015', summary:'SAP: error al contabilizar factura proveedor',       priority:'P2', status:'resuelto',          reporter:'smorales@petrotal-corp.com',   phone:'945123015', component:'ERP / SAP',                    created:d(9),  assigned_to:af.id,   assigned_to_name:af.full_name, sla_deadline:sla(9,4), assigned_at:d(9), first_response_at:d(9), resolved_at:d(8), resolution_note:'Se corrigió posición de cuenta contable con FI team.' },
            { key:'TK-P016', summary:'Videoconferencia con HQ — sin audio en sala ejecutiva', priority:'P2', status:'resuelto',     reporter:'rberrios@petrotal-corp.com',   phone:'945123016', component:'Comunicaciones Satelitales',   created:d(10), assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(10,4),assigned_at:d(10),first_response_at:d(10),resolved_at:d(9), resolution_note:'Driver de audio desactualizado. Actualizado y reiniciado.' },
            { key:'TK-P017', summary:'Backup no ejecutó el fin de semana — servidor SCADA', priority:'P1', status:'resuelto',        reporter:'jortega@petrotal-corp.com',    phone:'945123017', component:'Infraestructura y Redes',      created:d(12), assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(12,2),assigned_at:d(12),first_response_at:d(12),resolved_at:d(11),resolution_note:'Tarea de backup reconfigurda y validada con ejecución manual.' },
            // Cerrados
            { key:'TK-P018', summary:'Teclado y mouse inalámbrico sin funcionar',          priority:'P4', status:'cerrado',           reporter:'icastro@petrotal-corp.com',    phone:'945123018', component:'Equipos y Periféricos',        created:d(15), assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(15,8),assigned_at:d(15),first_response_at:d(15),resolved_at:d(14),closed_at:d(13),resolution_note:'Pilas reemplazadas. Receptor USB reubicado.',       close_comment:'Confirmado por usuario. Cerrado.' },
            { key:'TK-P019', summary:'Creación de cuenta SAP para analista de contratos',  priority:'P3', status:'cerrado',           reporter:'pvasquez@petrotal-corp.com',   phone:'945123019', component:'ERP / SAP',                    created:d(18), assigned_to:af.id,   assigned_to_name:af.full_name, sla_deadline:sla(18,8),assigned_at:d(18),first_response_at:d(18),resolved_at:d(17),closed_at:d(16),resolution_note:'Usuario creado con roles básicos SD/MM.',              close_comment:'Acceso validado. Cerrado.' },
            { key:'TK-P020', summary:'Red wifi lenta en área administrativa Lima',          priority:'P3', status:'cerrado',           reporter:'ovalencia@petrotal-corp.com',  phone:'945123020', component:'Infraestructura y Redes',      created:d(20), assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(20,4),assigned_at:d(20),first_response_at:d(20),resolved_at:d(19),closed_at:d(18),resolution_note:'Canal WiFi cambiado a 5GHz y QoS configurado.',       close_comment:'Velocidad normalizada. Cerrado.' },
            { key:'TK-P021', summary:'Laptop sin carga de batería — Geofísica',            priority:'P3', status:'cerrado',           reporter:'fquiroga@petrotal-corp.com',   phone:'945123021', component:'Equipos y Periféricos',        created:d(22), assigned_to:cm.id,   assigned_to_name:cm.full_name, sla_deadline:sla(22,8),assigned_at:d(22),first_response_at:d(22),resolved_at:d(21),closed_at:d(20),resolution_note:'Cargador defectuoso reemplazado por activo en stock.', close_comment:'Cerrado por usuario.' },
            { key:'TK-P022', summary:'VPN bloqueada por antivirus corporativo',            priority:'P2', status:'cerrado',           reporter:'hmedina@petrotal-corp.com',    phone:'945123022', component:'Seguridad y Accesos',          created:d(25), assigned_to:jq.id,   assigned_to_name:jq.full_name, sla_deadline:sla(25,4),assigned_at:d(25),first_response_at:d(25),resolved_at:d(24),closed_at:d(23),resolution_note:'Exclusión agregada en policy de antivirus.',          close_comment:'VPN conecta correctamente. Cerrado.' },
            { key:'TK-P023', summary:'Error de impresión en facturación — SAP',            priority:'P2', status:'cerrado',           reporter:'kpacheco@petrotal-corp.com',   phone:'945123023', component:'ERP / SAP',                    created:d(28), assigned_to:af.id,   assigned_to_name:af.full_name, sla_deadline:sla(28,4),assigned_at:d(28),first_response_at:d(28),resolved_at:d(27),closed_at:d(26),resolution_note:'Driver de impresora actualizado en servidor SAP.',     close_comment:'Impresión validada en producción. Cerrado.' },
        ];

        for (const t of tickets) {
            await q(
                `INSERT INTO jira_tickets
                 (ticket_key, summary, reporter, phone, component, priority, internal_status, status,
                  assigned_to, assigned_to_name, assigned_at, first_response_at, resolved_at,
                  resolution_note, closed_at, close_comment, sla_deadline, tenant_id, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    t.key, t.summary, t.reporter, t.phone || null, t.component,
                    t.priority, t.status, t.status === 'abierto' ? 'Abierto' : t.status,
                    t.assigned_to || null, t.assigned_to_name || null,
                    t.assigned_at || null, t.first_response_at || null,
                    t.resolved_at || null, t.resolution_note || null,
                    t.closed_at || null, t.close_comment || null,
                    t.sla_deadline || null, TENANT, t.created, t.created,
                ]
            ).catch(e => console.warn(`⚠️ ${t.key}: ${e.message}`));
        }

        console.log(`✅ Demo Petrotal: ${staff.length} usuarios + ${tickets.length} tickets creados`);
    },
    async down(queryInterface) {
        const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
        await q(`DELETE FROM jira_tickets WHERE ticket_key LIKE 'TK-P%' AND tenant_id=?`, [5]);
        await q(`DELETE FROM users WHERE email LIKE '%@petrotal-corp.com' AND role IN ('especialista','tecnico','administrador') AND username LIKE '%.pt'`, []);
    },
};

'use strict';
/**
 * Seed: 45 incidencias locales realistas para el sistema de gestión local.
 * Crea tickets TK-xxx con distribución realista de estados, prioridades,
 * técnicos, categorías y fechas (últimos 90 días).
 *
 * Uso: node scripts/seed-incidencias-local.js
 */

require('dotenv').config();
const { dbQuery } = require('../routes/jira/helpers');

// ── Configuración ─────────────────────────────────────────────────────────────

const NOW = new Date();
const daysAgo = d => new Date(NOW - d * 86400000);
const hoursAgo = h => new Date(NOW - h * 3600000);
const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ');

// ── Datos de referencia ───────────────────────────────────────────────────────

const COMPONENTS = [
    { id: '10001', name: 'Conectividad / Red' },
    { id: '10002', name: 'Hardware / Equipos' },
    { id: '10003', name: 'Software / Aplicaciones' },
    { id: '10004', name: 'Accesos / Seguridad' },
    { id: '10005', name: 'Infraestructura / Servidores' },
    { id: '10006', name: 'Impresoras / Periféricos' },
    { id: '10007', name: 'Correo / Comunicaciones' },
    { id: '10008', name: 'Base de Datos' },
];

const TIPOLOGIAS = [
    { id: '20001', name: 'Falla de conexión' },
    { id: '20002', name: 'Equipo no enciende' },
    { id: '20003', name: 'Error de aplicación' },
    { id: '20004', name: 'Acceso denegado' },
    { id: '20005', name: 'Caída de servicio' },
    { id: '20006', name: 'Lentitud del sistema' },
    { id: '20007', name: 'Pérdida de datos' },
    { id: '20008', name: 'Virus / Malware' },
    { id: '20009', name: 'Impresora no responde' },
    { id: '20010', name: 'Correo no envía/recibe' },
];

const APPS = [
    { id: '30001', name: 'SAP' },
    { id: '30002', name: 'Microsoft Teams' },
    { id: '30003', name: 'Outlook' },
    { id: '30004', name: 'VPN' },
    { id: '30005', name: 'Power BI' },
    { id: '30006', name: 'Active Directory' },
    { id: '30007', name: 'Bizagi' },
    { id: '30008', name: 'Antivirus' },
];

const REPORTERS = [
    { email: 'jperez@petrotal.pe',      name: 'José Pérez',       phone: '999-111-001', dept: 'Operaciones' },
    { email: 'mflores@petrotal.pe',     name: 'María Flores',     phone: '999-111-002', dept: 'Finanzas' },
    { email: 'caramos@petrotal.pe',     name: 'Carlos Ramos',     phone: '999-111-003', dept: 'RRHH' },
    { email: 'lcastro@petrotal.pe',     name: 'Lucía Castro',     phone: '999-111-004', dept: 'Logística' },
    { email: 'rvargas@petrotal.pe',     name: 'Roberto Vargas',   phone: '999-111-005', dept: 'Gerencia' },
    { email: 'anunez@petrotal.pe',      name: 'Ana Núñez',        phone: '999-111-006', dept: 'Contabilidad' },
    { email: 'fmendoza@petrotal.pe',    name: 'Fernando Mendoza', phone: '999-111-007', dept: 'Legal' },
    { email: 'smartinez@petrotal.pe',   name: 'Sofía Martínez',   phone: '999-111-008', dept: 'Comercial' },
    { email: 'dchavez@petrotal.pe',     name: 'Diego Chávez',     phone: '999-111-009', dept: 'Proyectos' },
    { email: 'itorres@petrotal.pe',     name: 'Isabel Torres',    phone: '999-111-010', dept: 'Sistemas' },
];

const DEVICE_CODES = [
    'PC-LIM-001', 'PC-LIM-002', 'PC-LIM-015', 'PC-LIM-023',
    'LPT-LIM-005', 'LPT-LIM-008', 'LPT-LIM-012',
    'IMP-LIM-003', 'IMP-LIM-007',
    'SRV-LIM-001', 'SRV-LIM-002',
    null, null, null,
];

const PRIORITIES = ['P1', 'P1', 'P2', 'P2', 'P2', 'P3', 'P3', 'P3', 'P3', 'P4'];
const URGENCIES  = ['Alta', 'Alta', 'Media', 'Media', 'Media', 'Baja', 'Baja', 'Baja', 'Baja', 'Muy Baja'];
const URGENCY_LEVELS = [3, 3, 2, 2, 2, 1, 1, 1, 1, 1];
const IMPACTS    = ['Alto', 'Alto', 'Medio', 'Medio', 'Bajo', 'Bajo', 'Bajo', 'Bajo', 'Bajo', 'Bajo'];

const STATUSES = [
    // status local, peso para distribución realista
    { s: 'abierto',           w: 8  },
    { s: 'asignado',          w: 6  },
    { s: 'en_progreso',       w: 8  },
    { s: 'pendiente_usuario', w: 4  },
    { s: 'resuelto',          w: 10 },
    { s: 'cerrado',           w: 9  },
];

const SUMMARIES = [
    'No puedo conectarme a la VPN desde casa',
    'SAP no carga módulo de nómina',
    'Pantalla azul en equipo de usuario',
    'Error al imprimir desde área de finanzas',
    'Correo no llega a destinatarios externos',
    'Lentitud extrema en sistema de reportes Power BI',
    'Acceso denegado a carpeta compartida del servidor',
    'Equipo de gerencia no enciende',
    'Teams no permite unirse a reuniones',
    'Base de datos SAP muestra error de conexión',
    'Antivirus bloquea aplicación de gestión',
    'Impresora HP LaserJet no aparece en red',
    'No puedo acceder al sistema de facturación',
    'Internet muy lento en piso 3 del edificio',
    'Error 500 en portal web de RRHH',
    'Mouse y teclado no responden tras actualización',
    'Backup nocturno falló — servidor de archivos',
    'Contraseña de Active Directory expirada sin previo aviso',
    'Cámara web no funciona en videollamadas',
    'Disco duro lleno en servidor de producción',
    'Outlook no sincroniza calendario compartido',
    'Firewall bloquea acceso a sistema externo de proveedor',
    'Error al exportar reporte a Excel desde Bizagi',
    'Equipo portátil no detecta monitor externo',
    'Switch de red caído — piso 2 sin conectividad',
    'Solicitud de instalación de software autorizado',
    'Pantalla con líneas horizontales en monitor',
    'Teclado físico con teclas trabadas',
    'No puedo abrir archivos PDF desde correo',
    'Cuenta de usuario bloqueada por intentos fallidos',
    'Error de licencia en Microsoft Office',
    'Servidor de impresión no disponible',
    'Falla en UPS — área de servidores en riesgo',
    'No carga el sistema de control de asistencia',
    'Error de sincronización en OneDrive corporativo',
    'Ruido extraño en equipo de escritorio',
    'Problema de audio en auriculares USB',
    'No puedo acceder a intranet desde VPN',
    'Error al adjuntar archivos en el sistema de tickets',
    'Sistema de CCTV no graba correctamente',
    'Falla de autenticación en portal de proveedores',
    'Lentitud en consultas de base de datos',
    'No funciona el lector de huella dactilar',
    'Error al instalar actualizaciones de Windows',
    'Caída del servicio de correo corporativo',
];

const RESOLUTION_NOTES = [
    'Se reinició el servicio de VPN y se actualizó el cliente. Problema resuelto.',
    'Se ejecutó reparación de Office. El módulo SAP volvió a funcionar correctamente.',
    'Se identificó falla en RAM. Se reemplazó el módulo y se estabilizó el equipo.',
    'Se reconfiguró la cola de impresión y se reinstalaron los drivers.',
    'Se ajustó la configuración SPF/DKIM del servidor de correo.',
    'Se optimizaron las consultas del datasource en Power BI.',
    'Se otorgaron los permisos correctos en el servidor de archivos.',
    'Se detectó falla en fuente de poder. Se reemplazó el componente.',
    'Se actualizó Teams a la última versión y se limpió la caché.',
    'Se reinició el servicio de base de datos y se verificó la conectividad.',
];

// ── Función auxiliar ──────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(items) {
    const total = items.reduce((s, i) => s + (i.w || 1), 0);
    let r = Math.random() * total;
    for (const item of items) { r -= (item.w || 1); if (r <= 0) return item.s; }
    return items[0].s;
}

function slaDeadline(priority, createdAt) {
    const hours = { P1: 4, P2: 8, P3: 24, P4: 72 };
    return new Date(createdAt.getTime() + (hours[priority] || 24) * 3600000);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔍 Verificando usuarios técnicos disponibles...');

    const techUsers = await dbQuery(
        "SELECT id, full_name AS name, email FROM users WHERE role IN ('especialista','tecnico','agente','administrador') AND deleted_at IS NULL LIMIT 20"
    );

    const TECHS = techUsers.length > 0 ? techUsers : [
        { id: 1, name: 'Técnico Demo 1', email: 'tecnico1@sistema.local' },
        { id: 2, name: 'Técnico Demo 2', email: 'tecnico2@sistema.local' },
    ];

    console.log(`✅ Técnicos encontrados: ${TECHS.length}`);
    TECHS.forEach(t => console.log(`   - [${t.id}] ${t.name} (${t.email})`));

    // Obtener último TK-
    const lastTk = await dbQuery(
        "SELECT ticket_key FROM jira_tickets WHERE ticket_key LIKE 'TK-%' ORDER BY id DESC LIMIT 1"
    );
    let nextNum = 1;
    if (lastTk.length) {
        const match = lastTk[0].ticket_key.match(/TK-(\d+)/);
        if (match) nextNum = parseInt(match[1]) + 1;
    }
    console.log(`📋 Próximo número de ticket: TK-${nextNum}`);

    // ── Generar e insertar tickets ────────────────────────────────────────────
    let created = 0;
    const total = SUMMARIES.length;

    for (let i = 0; i < total; i++) {
        const key = `TK-${String(nextNum + i).padStart(4, '0')}`;

        // Fecha de creación distribuida en los últimos 90 días
        const daysBack = Math.floor(Math.random() * 90);
        const createdAt = daysAgo(daysBack);
        // Variación de hora
        createdAt.setHours(8 + Math.floor(Math.random() * 10));
        createdAt.setMinutes(Math.floor(Math.random() * 60));

        const pIdx     = Math.floor(Math.random() * PRIORITIES.length);
        const priority = PRIORITIES[pIdx];
        const urgency  = URGENCIES[pIdx];
        const urgLvl   = URGENCY_LEVELS[pIdx];
        const impact   = IMPACTS[Math.floor(Math.random() * IMPACTS.length)];
        const status   = pickWeighted(STATUSES);
        const comp     = pick(COMPONENTS);
        const tipo     = pick(TIPOLOGIAS);
        const app      = Math.random() > 0.3 ? pick(APPS) : null;
        const reporter = pick(REPORTERS);
        const device   = pick(DEVICE_CODES);
        const sla      = slaDeadline(priority, createdAt);
        const summary  = SUMMARIES[i];

        // Asignación (tickets abiertos pueden estar sin asignar)
        let tech = null;
        if (status !== 'abierto' || Math.random() > 0.4) {
            tech = pick(TECHS);
        }

        const assignedAt      = tech ? new Date(createdAt.getTime() + Math.random() * 3600000) : null;
        const firstResponseAt = tech ? new Date(assignedAt.getTime() + Math.random() * 1800000) : null;

        // Resolución para estados resuelto/cerrado
        let resolvedAt    = null;
        let closedAt      = null;
        let resNote       = null;
        let closedBy      = null;
        let closeComment  = null;
        let csat          = null;

        if (status === 'resuelto' || status === 'cerrado') {
            const resHours = Math.random() * 48 + 1;
            resolvedAt = new Date(createdAt.getTime() + resHours * 3600000);
            resNote = pick(RESOLUTION_NOTES);

            if (status === 'cerrado') {
                closedAt     = new Date(resolvedAt.getTime() + Math.random() * 86400000);
                closedBy     = tech ? tech.name : 'Sistema';
                closeComment = 'Confirmado por el usuario. Ticket cerrado.';
                csat         = (Math.floor(Math.random() * 3) + 3); // 3, 4 o 5
            }
        }

        const jiraUrl = null; // tickets locales no tienen URL de Jira

        await dbQuery(`
            INSERT INTO jira_tickets (
                ticket_key, summary, description,
                status, internal_status,
                priority, urgency, urgency_level, impact, impact_label,
                component, component_id, app_item, app_id,
                tipologia, tipologia_id,
                reporter, phone,
                assigned_to, assigned_to_name, assigned_at,
                first_response_at, resolved_at, closed_at,
                resolution_note, closed_by, close_comment,
                sla_deadline, jira_url, device_code,
                created_at
            ) VALUES (
                ?, ?, ?,
                ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?
            )
        `, [
            key, summary, `Descripción detallada: ${summary}. Reportado desde ${reporter.dept}.`,
            status, status,
            priority, urgency, urgLvl, impact, impact,
            comp.name, comp.id, app?.name || null, app?.id || null,
            tipo.name, tipo.id,
            reporter.email, reporter.phone,
            tech?.id || null, tech?.name || null, assignedAt ? fmt(assignedAt) : null,
            firstResponseAt ? fmt(firstResponseAt) : null,
            resolvedAt ? fmt(resolvedAt) : null,
            closedAt ? fmt(closedAt) : null,
            resNote, closedBy, closeComment,
            fmt(sla), jiraUrl, device,
            fmt(createdAt),
        ]);

        // Añadir comentarios a tickets con actividad
        if (status !== 'abierto' && tech) {
            await dbQuery(`
                INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at)
                VALUES (?, ?, ?, 'comentario', ?)
            `, [key, tech.id, `Revisando el problema reportado. Se está investigando la causa raíz.`, fmt(assignedAt)]);

            if (status === 'resuelto' || status === 'cerrado') {
                await dbQuery(`
                    INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at)
                    VALUES (?, ?, ?, 'resolucion', ?)
                `, [key, tech.id, resNote, fmt(resolvedAt)]);
            }
        }

        // Historial
        await dbQuery(`
            INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle, created_at)
            VALUES (?, 0, 'Sistema', 'creacion', ?, ?)
        `, [key, `Ticket creado por ${reporter.name}`, fmt(createdAt)]);

        if (tech && assignedAt) {
            await dbQuery(`
                INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle, created_at)
                VALUES (?, ?, ?, 'asignacion', ?, ?)
            `, [key, tech.id, tech.name, `Asignado a ${tech.name}`, fmt(assignedAt)]);
        }

        created++;
        process.stdout.write(`\r   Creando tickets: ${created}/${total} [${key}]`);
    }

    // ── Encuestas CSAT para tickets cerrados ──────────────────────────────────
    console.log('\n📊 Verificando encuestas CSAT...');
    const closedTickets = await dbQuery(
        "SELECT ticket_key, reporter FROM jira_tickets WHERE ticket_key LIKE 'TK-%' AND internal_status='cerrado' ORDER BY id DESC LIMIT 20"
    );

    let csatCreated = 0;
    for (const t of closedTickets) {
        const existing = await dbQuery(
            'SELECT id FROM itsm_surveys WHERE ticket_key=?', [t.ticket_key]
        );
        if (!existing.length) {
            const token = `survey_${t.ticket_key}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
            const rating = Math.floor(Math.random() * 3) + 3;
            await dbQuery(`
                INSERT INTO itsm_surveys (ticket_key, token, reporter_email, rating, comment, responded_at)
                VALUES (?, ?, ?, ?, ?, NOW())
            `, [
                t.ticket_key, token, t.reporter, rating,
                rating >= 4 ? 'Excelente atención, muy rápido.' : 'Tomó más tiempo del esperado pero lo resolvieron.'
            ]);
            csatCreated++;
        }
    }
    console.log(`✅ Encuestas CSAT creadas: ${csatCreated}`);

    console.log(`\n✅ Seed completado: ${created} tickets TK- insertados`);
    console.log(`   Rango: TK-${String(nextNum).padStart(4,'0')} → TK-${String(nextNum+total-1).padStart(4,'0')}`);
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Error en seed:', err.message);
    process.exit(1);
});

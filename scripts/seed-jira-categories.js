require('dotenv').config();
const { executeQuery, equipmentPool } = require('../config/database');
const db = (sql, p = []) => executeQuery(equipmentPool, sql, p);

// IDs exactos que usan las categorías locales que SÍ crean tickets
const COMP_ID    = 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277';
const COMP_LABEL = 'Workplace';
const APP_ID     = 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11280';
const APP_LABEL  = 'Equipo Corporativo';

const GROUPS = [
  { name: 'Accesos / Conectividad', icon: 'bi-wifi', items: [
    '+Simple Residencial – No se puede acceder a la aplicación',
    'Citrix – Error al cargar aplicación desde fuera de la red corporativa',
    'Citrix – Error de conectividad desde fuera de la red corporativa',
    'Citrix – No se puede cambiar la contraseña desde fuera de la red corporativa',
    'Citrix – Problemas con doble autenticación desde fuera de la red corporativa',
    'Citrix – Problemas para iniciar sesión desde fuera de la red corporativa',
    'Credenciales – Problemas con usuario/contraseña de red',
    'Gescab – No se puede acceder a la aplicación',
    'Gescab – Versión del sistema desactualizada',
    'ISIS – No se puede acceder a la aplicación',
    'Red corporativa – Intermitencia en TEFWIFINT',
    'Red corporativa – Intermitencia general',
    'Red corporativa – Lentitud en TEFWIFINT',
    'Red corporativa – Lentitud general',
    'Red corporativa – No hay conexión en TEFWIFINT',
    'Red corporativa – No hay conexión general',
    'SAP – No se puede acceder a la aplicación',
    'SRM – No se puede acceder a la aplicación',
  ]},
  { name: 'Consultas Generales', icon: 'bi-question-circle', items: [
    'Procedimientos - Instrucciones',
  ]},
  { name: 'Equipo Corporativo', icon: 'bi-pc-display', items: [
    'Almacenamiento - Disco D lleno',
    'Almacenamiento – Disco C lleno',
    'Audio – Problemas con el audio',
    'Conectividad – Problemas con internet',
    'Conectividad – Sin acceso a Escritorio Remoto',
    'Conectividad – Sin acceso a red corporativa',
    'Hardware – Pantalla rota o dañada',
    'Hardware – Problemas con el cargador',
    'Hardware – Problemas con la batería',
    'Hardware – Problemas con mouse',
    'Hardware – Problemas con teclado',
    'Hardware – Sonido extraño en el equipo',
    'Inicio de sesión – Actualizaciones fallidas',
    'Inicio de sesión – Fecha y hora desactualizadas',
    'Inicio de sesión – Mensaje de activación de licencia',
    'Inicio de sesión – No carga sistema operativo',
    'Inicio de sesión – Problemas para iniciar sesión',
    'Navegadores – Google Chrome',
    'Navegadores – Microsoft Edge',
    'Otros problemas',
    'Post Renovación Tecnológica – INCIDENCIAS RT',
    'Rendimiento – No cargan sistemas comerciales',
    'Rendimiento – No responde, no enciende equipo',
    'Rendimiento – Reinicios constantes',
    'Rendimiento – Sistema lento o congelado',
    'Seguridad – Alerta de virus',
    'Software Telefónica – No cargan aplicaciones',
  ]},
  { name: 'Microsoft 365', icon: 'bi-microsoft', items: [
    'Excel – Error al guardar en OneDrive',
    'Excel – No puedo abrir archivos compartidos',
    'Excel – No responde o se cierra solo',
    'Excel – Problemas con macros o fórmulas',
    'MFA – Cambio de número móvil',
    'MFA – No puedo configurar MFA en nuevo dispositivo',
    'MFA – No recibo el código en el teléfono',
    'MFA – Problemas con Microsoft Authenticator',
    'O365 Otros – Access no responde',
    'O365 Otros – PowerPoint no carga presentaciones',
    'O365 Otros – Problemas con Word',
    'Office 365 - Consulta sobre migración',
    'Office 365 - Problemas técnicos en migración',
    'Office365 Web – Error al abrir documentos desde SharePoint',
    'Office365 Web – No puedo acceder a Office 365 en navegador',
    'Office365 Web – Word en línea no guarda cambios',
    'OneDrive – No arranca al iniciar sesión',
    'OneDrive – No puedo compartir documentos',
    'OneDrive – No puedo sincronizar archivos',
    'OneDrive – No tengo espacio en OneDrive',
    'OneNote – Errores de acceso y autenticación',
    'OneNote – Pérdida de datos o contenido',
    'OneNote – Problemas de sincronización',
    'Outlook – Firma de correo desconfigurada',
    'Outlook – Mensaje de "Buzón lleno"',
    'Outlook – No puedo enviar o recibir correos',
    'Outlook – No puedo iniciar sesión',
    'Outlook – No sincroniza correos',
    'SharePoint – Error al sincronizar con OneDrive',
    'SharePoint – No puedo acceder a un sitio',
    'SharePoint – No puedo cargar archivos',
    'SharePoint – No tengo permisos para editar',
    'Teams – Necesito crear grupos',
    'Teams – No puedo iniciar sesión',
    'Teams – No se pueden programar reuniones',
    'Teams – Teams se cierra inesperadamente',
    'Workplace Facebook – No puedo acceder',
  ]},
  { name: 'Servicios de impresión', icon: 'bi-printer', items: [
    'Impresora – Código PIN',
    'Impresora – No imprime',
    'Impresora – No llega el escaneado (bandeja)',
    'Impresora – No llega el escaneado (correo)',
  ]},
  { name: 'Software Comercial / Utilitario', icon: 'bi-box-seam', items: [
    'Bizagi – No puedo acceder a la aplicación',
    'Centro de Software – No permite instalar app',
    'Checkpoint – No puedo acceder a la aplicación',
    'Citrix – No puedo acceder a la aplicación',
    'FortiClient – No puedo acceder a la aplicación',
    'Google Earth Pro – No puedo acceder a la aplicación',
    'IZArc – No puedo acceder a la aplicación',
    'Microsoft Forms – Errores de conexión',
    'Microsoft Forms – Problemas de permisos',
    'Microsoft Project – Errores de acceso y autenticación',
    'Microsoft Project – Fallos de sincronización',
    'Microsoft Project – Problemas de instalación y activación',
    'Microsoft Visio – Errores de acceso y autenticación',
    'Microsoft Visio – Fallos de sincronización',
    'Microsoft Visio – Problemas de instalación y activación',
    'Notepad++ – No puedo acceder a la aplicación',
    'Oracle – No puedo acceder a la aplicación',
    'Otro software comercial – No puedo acceder',
    'Power Apps – Errores de conexión',
    'Power Apps – Problemas de permisos',
    'Power Automate – Errores de conexión',
    'Power Automate – Problemas de permisos',
    'Power BI – No puedo acceder a la aplicación',
    'SQL Management/Server – No puedo acceder',
    'Teradata – No puedo acceder a la aplicación',
    'WinSCP – No puedo acceder a la aplicación',
  ]},
];

async function seed() {
    console.log('🌱 Seeding categorías Jira con IDs locales...\n');
    await db(`CREATE TABLE IF NOT EXISTS ticket_categories (
        id INT PRIMARY KEY AUTO_INCREMENT, parent_id INT DEFAULT NULL,
        name VARCHAR(255) NOT NULL, icon VARCHAR(50) DEFAULT 'bi-tag',
        component_id VARCHAR(120), component_label VARCHAR(100),
        app_id VARCHAR(120), app_label VARCHAR(100),
        tipologia_id VARCHAR(120), tipologia_label VARCHAR(100),
        impact_id VARCHAR(20) DEFAULT '618437', impact_label VARCHAR(100),
        urgency_id VARCHAR(20) DEFAULT '618441', urgency_label VARCHAR(100),
        description_template TEXT, sort_order INT DEFAULT 0,
        is_active TINYINT DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cat_parent (parent_id))`);

    let inserted = 0, skipped = 0;

    for (let gi = 0; gi < GROUPS.length; gi++) {
        const g = GROUPS[gi];

        // Buscar o crear grupo padre (sin IDs Jira, solo nombre)
        const ep = await db(`SELECT id FROM ticket_categories WHERE name=? AND parent_id IS NULL LIMIT 1`, [g.name]);
        let parentId;
        if (ep.length > 0) {
            parentId = ep[0].id;
            console.log(`  ⏭  "${g.name}" ya existe (id=${parentId})`);
        } else {
            await db(`INSERT INTO ticket_categories (name, icon, sort_order, is_active) VALUES (?,?,?,1)`,
                [g.name, g.icon, gi * 10]);
            const lid = await db(`SELECT LAST_INSERT_ID() AS id`);
            parentId = lid[0]?.id;
            inserted++;
            console.log(`  ➕ Grupo "${g.name}" (id=${parentId})`);
        }

        for (let ii = 0; ii < g.items.length; ii++) {
            const label = g.items[ii];
            const ei = await db(`SELECT id FROM ticket_categories WHERE name=? AND parent_id=? LIMIT 1`, [label, parentId]);
            if (ei.length > 0) { skipped++; continue; }
            await db(
                `INSERT INTO ticket_categories
                   (parent_id, name, icon,
                    component_id, component_label, app_id, app_label,
                    tipologia_id, impact_id, urgency_id,
                    description_template, sort_order, is_active)
                 VALUES (?,?,?, ?,?,?,?, NULL,'618437','618441', ?,?,1)`,
                [parentId, label, g.icon,
                 COMP_ID, COMP_LABEL, APP_ID, APP_LABEL,
                 `${label}.`, ii]
            );
            inserted++;
        }
        console.log(`     └── ${g.items.length} ítems`);
    }

    console.log(`\n✅ ${inserted} insertadas, ${skipped} ya existían.`);
    process.exit(0);
}

seed().catch(e => { console.error('❌', e.message); process.exit(1); });
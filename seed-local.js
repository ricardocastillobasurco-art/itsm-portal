/**
 * seed-local.js — Datos de ejemplo para Catálogo, Cambios y Problemas
 * Uso: node seed-local.js
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const sequelize = require('./src/config/database');

const now  = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const days = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

async function run() {
  await sequelize.authenticate();
  console.log('✅ Conectado a la BD\n');

  // ─── Tablas pendientes ───────────────────────────────────────────
  console.log('🏗️  Verificando tablas...');
  const q = sql => sequelize.query(sql);

  await q(`ALTER TABLE changes MODIFY COLUMN status ENUM(
    'borrador','pendiente_aprobacion','aprobado','en_implementacion',
    'implementado','fallido','cancelado','revisado'
  ) NOT NULL DEFAULT 'borrador'`).catch(() => {});

  await q(`CREATE TABLE IF NOT EXISTS service_categories (
    id          CHAR(36)     NOT NULL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT         DEFAULT NULL,
    icon        VARCHAR(50)  DEFAULT NULL,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await q(`CREATE TABLE IF NOT EXISTS services (
    id                CHAR(36)     NOT NULL PRIMARY KEY,
    category_id       CHAR(36)     NOT NULL,
    name              VARCHAR(150) NOT NULL,
    description       TEXT         DEFAULT NULL,
    sla_hours         INT          NOT NULL DEFAULT 8,
    approval_required TINYINT(1)   NOT NULL DEFAULT 0,
    approver_role     VARCHAR(50)  DEFAULT NULL,
    form_schema       JSON         DEFAULT NULL,
    is_active         TINYINT(1)   NOT NULL DEFAULT 1,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        DATETIME     DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await q(`CREATE TABLE IF NOT EXISTS service_requests (
    id                CHAR(36)     NOT NULL PRIMARY KEY,
    request_number    VARCHAR(30)  NOT NULL UNIQUE,
    service_id        CHAR(36)     NOT NULL,
    tenant_id         INT UNSIGNED DEFAULT NULL,
    requester_id      CHAR(36)     NOT NULL,
    assigned_to       CHAR(36)     DEFAULT NULL,
    status            ENUM('nuevo','en_proceso','pendiente_usuario','resuelto','cancelado') NOT NULL DEFAULT 'nuevo',
    priority          ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
    form_data         JSON         DEFAULT NULL,
    notes             TEXT         DEFAULT NULL,
    resolved_at       DATETIME     DEFAULT NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        DATETIME     DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  console.log('   ✅ Tablas listas\n');

  // ─── Superadmin ID ───────────────────────────────────────────────
  const [admin] = await sequelize.query(
    `SELECT id FROM users WHERE role = 'superadmin' LIMIT 1`,
    { type: 'SELECT' }
  );
  const adminId  = admin?.id || null;
  const tenantId = 1;

  // ─── CATÁLOGO ────────────────────────────────────────────────────
  console.log('📦 Creando catálogo de servicios...');
  const cats = [
    { id: uuidv4(), name: 'Infraestructura TI',     icon: 'bi-hdd-network',    description: 'Servidores, redes y almacenamiento' },
    { id: uuidv4(), name: 'Soporte al Usuario',     icon: 'bi-person-gear',    description: 'Asistencia técnica a usuarios finales' },
    { id: uuidv4(), name: 'Aplicaciones y Software', icon: 'bi-app-indicator',  description: 'ERP, correo, herramientas de negocio' },
    { id: uuidv4(), name: 'Seguridad Informática',   icon: 'bi-shield-check',   description: 'Accesos, auditorías y cumplimiento' },
  ];

  const catServices = [
    // Infraestructura
    { catIdx: 0, name: 'Soporte de Red',            description: 'Diagnóstico y resolución de problemas de conectividad',   slaHours: 4  },
    { catIdx: 0, name: 'Configuración de Servidores', description: 'Alta, baja y cambios de configuración en servidores',   slaHours: 8  },
    { catIdx: 0, name: 'Gestión de Respaldos',       description: 'Verificación y restauración de backups',                 slaHours: 24 },
    // Soporte
    { catIdx: 1, name: 'Reset de Contraseña',        description: 'Desbloqueo y restablecimiento de credenciales',          slaHours: 2, approvalRequired: false },
    { catIdx: 1, name: 'Acceso a Sistemas',           description: 'Alta de permisos y accesos a plataformas internas',      slaHours: 8, approvalRequired: true, approverRole: 'supervisor' },
    { catIdx: 1, name: 'Instalación de Software',     description: 'Despliegue de aplicaciones en equipos de usuario',       slaHours: 4  },
    // Aplicaciones
    { catIdx: 2, name: 'Soporte ERP',                description: 'Incidencias y consultas del sistema ERP corporativo',    slaHours: 8  },
    { catIdx: 2, name: 'Configuración de Correo',     description: 'Alta de buzones, grupos de distribución y listas',       slaHours: 4  },
    { catIdx: 2, name: 'Reporte de Bugs',             description: 'Registro de fallos en aplicaciones internas',            slaHours: 48 },
    // Seguridad
    { catIdx: 3, name: 'Revisión de Accesos',         description: 'Auditoría periódica de permisos y roles de usuarios',    slaHours: 72, approvalRequired: true, approverRole: 'administrador' },
    { catIdx: 3, name: 'Bloqueo de Cuenta',            description: 'Suspensión inmediata de acceso a usuario comprometido', slaHours: 1  },
  ];

  for (const cat of cats) {
    const [ex] = await sequelize.query(
      `SELECT id FROM service_categories WHERE name = ? LIMIT 1`,
      { replacements: [cat.name], type: 'SELECT' }
    );
    if (!ex) {
      await sequelize.query(
        `INSERT INTO service_categories (id,name,icon,description,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`,
        { replacements: [cat.id, cat.name, cat.icon || null, cat.description || null, now(), now()] }
      );
    } else {
      cat.id = ex.id;
    }
  }

  for (const svc of catServices) {
    const catId = cats[svc.catIdx].id;
    const [ex] = await sequelize.query(
      `SELECT id FROM services WHERE name = ? AND category_id = ? LIMIT 1`,
      { replacements: [svc.name, catId], type: 'SELECT' }
    );
    if (!ex) {
      await sequelize.query(
        `INSERT INTO services (id,category_id,name,description,sla_hours,approval_required,approver_role,is_active,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,1,?,?)`,
        { replacements: [uuidv4(), catId, svc.name, svc.description || null,
            svc.slaHours || 8, svc.approvalRequired ? 1 : 0,
            svc.approverRole || null, now(), now()] }
      );
    }
  }
  console.log(`   ✅ ${cats.length} categorías, ${catServices.length} servicios\n`);

  // ─── CAMBIOS ─────────────────────────────────────────────────────
  console.log('🔄 Creando cambios...');
  const today  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const year   = new Date().getFullYear();

  const cambios = [
    { title: 'Actualización MySQL 8.0 → 8.4 en servidor de producción', type: 'normal',    priority: 'alta',   riskLevel: 'alto',   status: 'aprobado',           plannedStart: days(3),  plannedEnd: days(4)  },
    { title: 'Migración de repositorio Git a nueva instancia',           type: 'estandar',  priority: 'media',  riskLevel: 'bajo',   status: 'en_implementacion',  plannedStart: days(-1), plannedEnd: days(1)  },
    { title: 'Parche de seguridad crítico en firewall perimetral',       type: 'emergencia', priority: 'critica', riskLevel: 'critico', status: 'implementado',      plannedStart: days(-2), plannedEnd: days(-2) },
    { title: 'Ampliación de almacenamiento en servidor NAS',             type: 'normal',    priority: 'media',  riskLevel: 'medio',  status: 'borrador'            },
    { title: 'Actualización de certificados SSL',                        type: 'estandar',  priority: 'alta',   riskLevel: 'bajo',   status: 'pendiente_aprobacion', plannedStart: days(7), plannedEnd: days(7)  },
    { title: 'Cambio de proveedor DNS principal',                        type: 'normal',    priority: 'alta',   riskLevel: 'alto',   status: 'cancelado'           },
    { title: 'Actualización de antivirus corporativo a v18',             type: 'estandar',  priority: 'baja',   riskLevel: 'bajo',   status: 'revisado',           plannedStart: days(-10), plannedEnd: days(-9) },
    { title: 'Reconfiguración de VLANs en switch core',                  type: 'normal',    priority: 'alta',   riskLevel: 'alto',   status: 'fallido',            plannedStart: days(-5), plannedEnd: days(-4) },
  ];

  for (let i = 0; i < cambios.length; i++) {
    const ch     = cambios[i];
    const num    = `CHG-${today}-${String(i + 1).padStart(4, '0')}`;
    const [ex]   = await sequelize.query(
      `SELECT id FROM changes WHERE change_number = ? LIMIT 1`,
      { replacements: [num], type: 'SELECT' }
    );
    if (!ex) {
      await sequelize.query(
        `INSERT INTO changes (id,tenant_id,change_number,title,description,type,status,priority,risk_level,requested_by,planned_start,planned_end,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        { replacements: [
            uuidv4(), tenantId, num, ch.title,
            `Descripción detallada: ${ch.title}`,
            ch.type, ch.status, ch.priority, ch.riskLevel, adminId,
            ch.plannedStart || null, ch.plannedEnd || null,
            now(), now()
          ]
        }
      );
    }
  }
  console.log(`   ✅ ${cambios.length} cambios\n`);

  // ─── PROBLEMAS ───────────────────────────────────────────────────
  console.log('🔍 Creando problemas...');
  const problemas = [
    { title: 'Caídas intermitentes en red de planta 3',          priority: 'alta',   status: 'en_investigacion', rootCause: null,                                 workaround: 'Reiniciar switch secundario' },
    { title: 'Lentitud generalizada en acceso al ERP en horario pico', priority: 'media', status: 'conocido',    rootCause: 'Índices fragmentados en tabla de movimientos', workaround: 'Ejecutar REINDEX en horas no productivas' },
    { title: 'Fallos esporádicos al imprimir desde red WiFi',    priority: 'baja',   status: 'abierto',          rootCause: null,                                 workaround: null },
    { title: 'Bloqueos de sesión en módulo de RRHH',             priority: 'alta',   status: 'resuelto',         rootCause: 'Race condition en gestión de tokens de sesión', resolution: 'Aplicado parche v2.3.1 del proveedor', workaround: null },
    { title: 'Notificaciones de correo duplicadas',              priority: 'media',  status: 'en_investigacion', rootCause: null,                                 workaround: 'Desactivar notificaciones automáticas temporalmente' },
    { title: 'Falla en proceso de backup nocturno',              priority: 'critica', status: 'conocido',        rootCause: 'Espacio insuficiente en volumen de destino', workaround: 'Backup manual a unidad alternativa' },
  ];

  for (let i = 0; i < problemas.length; i++) {
    const pb  = problemas[i];
    const num = `PRB-${year}-${String(i + 1).padStart(4, '0')}`;
    const [ex] = await sequelize.query(
      `SELECT id FROM problems WHERE problem_number = ? LIMIT 1`,
      { replacements: [num], type: 'SELECT' }
    );
    if (!ex) {
      await sequelize.query(
        `INSERT INTO problems (id,problem_number,title,description,status,priority,root_cause,workaround,resolution,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        { replacements: [
            uuidv4(), num, pb.title,
            `Descripción: ${pb.title}`,
            pb.status, pb.priority,
            pb.rootCause || null, pb.workaround || null, pb.resolution || null,
            now(), now()
          ]
        }
      );
    }
  }
  console.log(`   ✅ ${problemas.length} problemas\n`);

  await sequelize.close();
  console.log('✅ Seed completado. Recarga las páginas para ver los datos.');
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });

'use strict';

const sequelize = require('../config/database');
const bcrypt    = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const logger    = require('../utils/logger');

const VALID_ROLES       = ['administrador', 'admin', 'agente', 'tecnico', 'especialista', 'usuario'];
const VALID_CI_STATUS   = ['activo', 'inactivo', 'en_mantenimiento', 'retirado'];
const VALID_CI_ENV      = ['produccion', 'staging', 'desarrollo', 'dr'];
const VALID_TICKET_TIPO = ['incidente', 'solicitud', 'cambio', 'problema'];
const VALID_PRIORITY    = ['P1', 'P2', 'P3', 'P4'];
const VALID_KB_STATUS   = ['borrador', 'publicado', 'archivado'];

// ── Secciones disponibles con sus columnas requeridas / opcionales ────────────

const SECTIONS = {
  users: {
    label:    'Usuarios',
    required: ['email'],
    optional: ['full_name', 'username', 'role', 'employee_cip'],
    // role: administrador | agente | especialista | tecnico | usuario
    template: [
      'email,full_name,username,role,employee_cip',
      'juan.garcia@empresa.pe,Juan García,jgarcia,usuario,10001',
      'ana.torres@empresa.pe,Ana Torres,atorres,agente,10002',
      'carlos.ramos@empresa.pe,Carlos Ramos,cramos,especialista,10003',
      'lucia.mendez@empresa.pe,Lucía Méndez,lmendez,administrador,10004',
      'pedro.silva@empresa.pe,Pedro Silva,psilva,tecnico,10005',
    ].join('\n'),
  },
  config_items: {
    label:    'Equipos / CMDB',
    required: ['name'],
    optional: ['ci_type_id', 'status', 'environment', 'location', 'serial_number', 'ip_address'],
    // ci_type_id: 1=Servidor 2=Laptop 3=PC 4=Impresora 5=Red
    // status: activo | inactivo | en_mantenimiento | retirado
    // environment: produccion | staging | desarrollo | dr
    template: [
      'name,ci_type_id,status,environment,location,serial_number,ip_address',
      'Servidor HPE ProLiant ML350 Principal,1,activo,produccion,Data Center - Piso 1,SN-SRV-001,10.0.0.1',
      'Laptop Dell Latitude Juan García,2,activo,produccion,Oficina Lima - Piso 3,SN-DELL-001,192.168.1.101',
      'Laptop HP ProBook Ana Torres,2,activo,produccion,Sede Miraflores,SN-HP-001,192.168.1.102',
      'PC Escritorio Carlos Ramos,3,activo,produccion,Oficina Lima - Piso 2,SN-PC-001,192.168.1.50',
      'Impresora HP LaserJet Recepcion,4,activo,produccion,Recepcion - Piso 1,SN-IMP-001,192.168.1.200',
      'Switch Cisco Catalyst Core,5,activo,produccion,Sala de Comunicaciones,SN-SW-001,10.0.0.10',
      'Laptop Lenovo ThinkPad Pedro Silva,2,activo,produccion,Oficina Lima - Piso 4,SN-LEN-001,192.168.1.103',
      'Servidor Backup NAS Synology,1,activo,produccion,Data Center - Piso 1,SN-NAS-001,10.0.0.5',
    ].join('\n'),
  },
  tickets: {
    label:    'Incidencias',
    required: ['titulo'],
    optional: ['descripcion', 'tipo', 'priority', 'status'],
    // tipo: incidente | solicitud | cambio | problema
    // priority: P1 | P2 | P3 | P4
    // status: abierto | en_progreso | pendiente | resuelto | cerrado
    template: [
      'titulo,descripcion,tipo,priority,status',
      'Falla de red en piso 3,Red caída en el area de ventas afecta a 10 usuarios,incidente,P2,cerrado',
      'Solicitud acceso VPN,Nuevo colaborador requiere acceso remoto,solicitud,P3,resuelto',
      'Impresora no imprime,La impresora HP de recepcion no responde,incidente,P3,cerrado',
      'Instalacion Office 365,Requiere instalacion de suite Office en equipo nuevo,solicitud,P4,resuelto',
    ].join('\n'),
  },
  kb_articles: {
    label:    'Artículos de KB',
    required: ['title', 'content'],
    optional: ['excerpt', 'tags', 'status'],
    // status: borrador | publicado | archivado
    // tags: separar con punto y coma (;)
    template: [
      'title,content,excerpt,tags,status',
      'Como resetear contrasena,1. Ve a la pagina de login. 2. Haz clic en Olvide mi contrasena. 3. Ingresa tu correo corporativo. 4. Sigue las instrucciones del email.,Guia rapida para recuperar acceso,contrasena;acceso;login,publicado',
      'Configurar VPN corporativa,Descarga el cliente VPN desde el portal IT. Instala y configura con servidor vpn.empresa.pe. Usa tus credenciales de red.,Pasos para conectarse a la red desde casa,vpn;acceso remoto;red,publicado',
    ].join('\n'),
  },
};

// ─────────────────────────────────────────────────────────────────────────────

class TenantImportService {

  getSections() { return SECTIONS; }

  async importSection(tenantId, section, rows, actorId) {
    if (!SECTIONS[section]) throw new Error(`Sección desconocida: ${section}`);

    const { required } = SECTIONS[section];
    const results = { total: rows.length, inserted: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowNum = i + 2;

      const missing = required.filter(f => !row[f]?.toString().trim());
      if (missing.length) {
        results.errors.push({ row: rowNum, error: `Campos requeridos faltantes: ${missing.join(', ')}` });
        results.skipped++;
        continue;
      }

      try {
        await this[`_insert_${section}`](tenantId, row, actorId);
        results.inserted++;
      } catch (e) {
        results.errors.push({ row: rowNum, error: e.message });
        results.skipped++;
      }
    }

    logger.info('TenantImport completado', { tenantId, section, ...results });
    return results;
  }

  // ── Insertar Usuarios ────────────────────────────────────────────────────

  async _insert_users(tenantId, row, actorId) {
    const email = row.email.trim().toLowerCase();

    const [existing] = await sequelize.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      { replacements: [email], type: 'SELECT' }
    );
    if (existing) throw new Error(`Email ya registrado: ${email}`);

    const rawUsername = (row.username || row.nombre_usuario || email.split('@')[0]).trim();
    const username    = rawUsername.replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 100) || `user_${Date.now()}`;
    const fullName    = (row.full_name || row.nombre || username).trim().substring(0, 150);
    const role        = VALID_ROLES.includes(row.role) ? row.role : 'usuario';
    const employeeCip = (row.employee_cip || null);

    // Contraseña temporal: nombre_usuario@año (el admin debe notificar al usuario)
    const tempPass = await bcrypt.hash(`${username}@${new Date().getFullYear()}`, 10);

    await sequelize.query(
      `INSERT INTO users
         (id, username, full_name, email, password_hash, role, employee_cip, tenant_id, is_active, is_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW(), NOW())`,
      { replacements: [uuidv4(), username, fullName, email, tempPass, role, employeeCip, tenantId] }
    );
  }

  // ── Insertar Equipos / CMDB ──────────────────────────────────────────────

  async _insert_config_items(tenantId, row, actorId) {
    const name        = row.name.trim().substring(0, 255);
    const status      = VALID_CI_STATUS.includes(row.status)      ? row.status      : 'activo';
    const environment = VALID_CI_ENV.includes(row.environment)    ? row.environment : 'produccion';
    const location    = row.location     || null;
    const serial      = row.serial_number || null;
    const ip          = row.ip_address   || null;

    // ci_type_id: puede venir como UUID, nombre de tipo o número
    let ciTypeId = null;
    const rawType = (row.ci_type_id || '').trim();
    if (rawType) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawType);
      if (isUuid) {
        // Viene del export — usar directamente si existe en ci_types
        const [byId] = await sequelize.query(
          'SELECT id FROM ci_types WHERE id = ? LIMIT 1',
          { replacements: [rawType], type: 'SELECT' }
        );
        if (byId) ciTypeId = byId.id;
      }
      if (!ciTypeId) {
        // Buscar por nombre exacto (ej: "Servidor", "Laptop")
        const [byName] = await sequelize.query(
          'SELECT id FROM ci_types WHERE LOWER(name) = LOWER(?) LIMIT 1',
          { replacements: [rawType], type: 'SELECT' }
        );
        if (byName) ciTypeId = byName.id;
      }
      if (!ciTypeId) {
        // Fallback numérico (ej: "1" = primer tipo, "2" = segundo)
        const n = parseInt(rawType);
        if (n > 0) {
          const [byOrder] = await sequelize.query(
            'SELECT id FROM ci_types ORDER BY created_at LIMIT 1 OFFSET ?',
            { replacements: [n - 1], type: 'SELECT' }
          );
          if (byOrder) ciTypeId = byOrder.id;
        }
      }
    }
    if (!ciTypeId) {
      // Último recurso: primer tipo disponible
      const [first] = await sequelize.query(
        'SELECT id FROM ci_types ORDER BY created_at LIMIT 1',
        { type: 'SELECT' }
      );
      ciTypeId = first?.id || null;
    }
    if (!ciTypeId) throw new Error('No existe ningún tipo de CI en el sistema. Crea al menos uno antes de importar.');

    await sequelize.query(
      `INSERT INTO config_items
         (id, tenant_id, ci_type_id, name, status, environment, location, serial_number, ip_address, attributes, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, '{}', NOW(), NOW())`,
      { replacements: [tenantId, ciTypeId, name, status, environment, location, serial, ip] }
    );
  }

  // ── Insertar Incidencias ─────────────────────────────────────────────────

  async _insert_tickets(tenantId, row, actorId) {
    const tipo      = VALID_TICKET_TIPO.includes(row.tipo)     ? row.tipo     : 'incidente';
    const priority  = VALID_PRIORITY.includes(row.priority)    ? row.priority : 'P3';
    const status    = ['abierto','en_progreso','pendiente','resuelto','cerrado'].includes(row.status) ? row.status : 'cerrado';
    const titulo    = row.titulo.trim().substring(0, 500);
    const descripcion = (row.descripcion || '').trim();

    await sequelize.query(
      `INSERT INTO tickets
         (id, tenant_id, titulo, descripcion, tipo, status, priority, created_by, sla_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', NOW(), NOW())`,
      { replacements: [uuidv4(), tenantId, titulo, descripcion, tipo, status, priority, actorId || null] }
    );
  }

  // ── Insertar Artículos KB ────────────────────────────────────────────────

  async _insert_kb_articles(tenantId, row, actorId) {
    const title   = row.title.trim().substring(0, 500);
    const content = row.content.trim();
    const excerpt = (row.excerpt || content.substring(0, 200)).trim();
    const tags    = (row.tags || '').trim();
    const status  = VALID_KB_STATUS.includes(row.status) ? row.status : 'borrador';

    await sequelize.query(
      `INSERT INTO kb_articles
         (tenant_id, title, content, excerpt, tags, author_id, status, views, helpful_yes, helpful_no, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NOW(), NOW())`,
      { replacements: [tenantId, title, content, excerpt, tags, actorId || null, status] }
    );
  }
}

module.exports = new TenantImportService();

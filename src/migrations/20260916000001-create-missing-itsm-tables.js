'use strict';

module.exports = {
  async up(queryInterface, DataTypes) {
    const tables = await queryInterface.showAllTables();
    const has = (t) => tables.includes(t);

    // ── known_errors ─────────────────────────────────────────────────────────
    if (!has('known_errors')) {
      await queryInterface.createTable('known_errors', {
        id:           { type: DataTypes.CHAR(36),    primaryKey: true },
        problem_id:   { type: DataTypes.CHAR(36),    allowNull: false },
        title:        { type: DataTypes.STRING(255), allowNull: false },
        symptoms:     { type: DataTypes.TEXT,        allowNull: true },
        workaround:   { type: DataTypes.TEXT,        allowNull: true },
        resolution:   { type: DataTypes.TEXT,        allowNull: true },
        is_published: { type: DataTypes.BOOLEAN,     defaultValue: false },
        published_at: { type: DataTypes.DATE,        allowNull: true },
        created_at:   { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at:   { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        deleted_at:   { type: DataTypes.DATE,        allowNull: true },
      });
    }

    // ── ci_types ─────────────────────────────────────────────────────────────
    if (!has('ci_types')) {
      await queryInterface.createTable('ci_types', {
        id:          { type: DataTypes.CHAR(36),    primaryKey: true },
        name:        { type: DataTypes.STRING(100), allowNull: false },
        description: { type: DataTypes.TEXT,        allowNull: true },
        icon:        { type: DataTypes.STRING(50),  allowNull: true },
        schema_def:  { type: DataTypes.JSON,        allowNull: true },
        created_at:  { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at:  { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });

      // Tipos base de CI
      await queryInterface.bulkInsert('ci_types', [
        { id: '11111111-0001-0001-0001-000000000001', name: 'Servidor',          description: 'Servidores físicos y virtuales',      icon: 'bi-server',           schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000002', name: 'PC de Escritorio',  description: 'Computadoras de escritorio',           icon: 'bi-pc-display',       schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000003', name: 'Laptop',            description: 'Portátiles y notebooks',               icon: 'bi-laptop',           schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000004', name: 'Switch',            description: 'Switches de red',                      icon: 'bi-router-fill',      schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000005', name: 'Router',            description: 'Routers y gateways',                   icon: 'bi-hdd-network',      schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000006', name: 'Firewall',          description: 'Firewalls y dispositivos de seguridad', icon: 'bi-shield-lock-fill', schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000007', name: 'Impresora',         description: 'Impresoras y multifuncionales',         icon: 'bi-printer-fill',     schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000008', name: 'Aplicación',        description: 'Software y aplicaciones',              icon: 'bi-app-indicator',    schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000009', name: 'Base de Datos',     description: 'Motores y bases de datos',             icon: 'bi-database-fill',    schema_def: null, created_at: new Date(), updated_at: new Date() },
        { id: '11111111-0001-0001-0001-000000000010', name: 'UPS / Eléctrico',   description: 'UPS, PDUs y equipos eléctricos',       icon: 'bi-lightning-fill',   schema_def: null, created_at: new Date(), updated_at: new Date() },
      ]);
    }

    // ── config_items ─────────────────────────────────────────────────────────
    if (!has('config_items')) {
      await queryInterface.createTable('config_items', {
        id:            { type: DataTypes.CHAR(36),    primaryKey: true },
        tenant_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        ci_type_id:    { type: DataTypes.CHAR(36),    allowNull: false },
        name:          { type: DataTypes.STRING(150), allowNull: false },
        status:        { type: DataTypes.ENUM('activo','inactivo','en_mantenimiento','retirado'), defaultValue: 'activo' },
        environment:   { type: DataTypes.ENUM('produccion','staging','desarrollo','dr'),          defaultValue: 'produccion' },
        owner_id:      { type: DataTypes.CHAR(36),    allowNull: true },
        location:      { type: DataTypes.STRING(150), allowNull: true },
        ip_address:    { type: DataTypes.STRING(45),  allowNull: true },
        serial_number: { type: DataTypes.STRING(100), allowNull: true },
        version:       { type: DataTypes.STRING(50),  allowNull: true },
        attributes:    { type: DataTypes.JSON,        allowNull: true },
        created_at:    { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at:    { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        deleted_at:    { type: DataTypes.DATE,        allowNull: true },
      });
    }

    // ── ci_relationships ─────────────────────────────────────────────────────
    if (!has('ci_relationships')) {
      await queryInterface.createTable('ci_relationships', {
        id:           { type: DataTypes.CHAR(36), primaryKey: true },
        source_id:    { type: DataTypes.CHAR(36), allowNull: false },
        target_id:    { type: DataTypes.CHAR(36), allowNull: false },
        relationship: {
          type: DataTypes.ENUM('depende_de','conectado_a','instalado_en','virtualizado_en','contiene','respaldado_por'),
          defaultValue: 'conectado_a',
        },
        created_at:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
    }

    // ── service_categories ────────────────────────────────────────────────────
    if (!has('service_categories')) {
      await queryInterface.createTable('service_categories', {
        id:          { type: DataTypes.CHAR(36),    primaryKey: true },
        name:        { type: DataTypes.STRING(100), allowNull: false },
        description: { type: DataTypes.TEXT,        allowNull: true },
        icon:        { type: DataTypes.STRING(50),  allowNull: true },
        is_active:   { type: DataTypes.BOOLEAN,     defaultValue: true },
        created_at:  { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at:  { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });

      await queryInterface.bulkInsert('service_categories', [
        { id: '22222222-0001-0001-0001-000000000001', name: 'Infraestructura TI',          description: 'Servidores, redes y telecomunicaciones',     icon: 'bi-hdd-network',       is_active: 1, created_at: new Date(), updated_at: new Date() },
        { id: '22222222-0001-0001-0001-000000000002', name: 'Soporte al Usuario',          description: 'Atención a usuarios y resolución de incidencias', icon: 'bi-headset',       is_active: 1, created_at: new Date(), updated_at: new Date() },
        { id: '22222222-0001-0001-0001-000000000003', name: 'Aplicaciones y Software',     description: 'Gestión de aplicaciones empresariales',       icon: 'bi-app-indicator',    is_active: 1, created_at: new Date(), updated_at: new Date() },
        { id: '22222222-0001-0001-0001-000000000004', name: 'Seguridad Informática',       description: 'Ciberseguridad, accesos y cumplimiento',      icon: 'bi-shield-lock-fill', is_active: 1, created_at: new Date(), updated_at: new Date() },
      ]);
    }

    // ── services ──────────────────────────────────────────────────────────────
    if (!has('services')) {
      await queryInterface.createTable('services', {
        id:                { type: DataTypes.CHAR(36),    primaryKey: true },
        category_id:       { type: DataTypes.CHAR(36),    allowNull: false },
        name:              { type: DataTypes.STRING(150), allowNull: false },
        description:       { type: DataTypes.TEXT,        allowNull: true },
        sla_hours:         { type: DataTypes.INTEGER,     defaultValue: 8 },
        approval_required: { type: DataTypes.BOOLEAN,     defaultValue: false },
        approver_role:     { type: DataTypes.STRING(50),  allowNull: true },
        form_schema:       { type: DataTypes.JSON,        allowNull: true },
        is_active:         { type: DataTypes.BOOLEAN,     defaultValue: true },
        created_at:        { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at:        { type: DataTypes.DATE,        allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        deleted_at:        { type: DataTypes.DATE,        allowNull: true },
      });

      await queryInterface.bulkInsert('services', [
        // Infraestructura TI
        { id: '33333333-0001-0001-0001-000000000001', category_id: '22222222-0001-0001-0001-000000000001', name: 'Provisión de servidor virtual',  description: 'Creación y configuración de VMs',          sla_hours: 48, approval_required: 1, approver_role: 'administrador', form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000002', category_id: '22222222-0001-0001-0001-000000000001', name: 'Configuración de red y VPN',      description: 'Alta y cambios en segmentos de red o VPN', sla_hours: 24, approval_required: 1, approver_role: 'administrador', form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000003', category_id: '22222222-0001-0001-0001-000000000001', name: 'Mantenimiento de equipos',        description: 'Mantenimiento preventivo y correctivo',    sla_hours: 8,  approval_required: 0, approver_role: null,            form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        // Soporte al Usuario
        { id: '33333333-0001-0001-0001-000000000004', category_id: '22222222-0001-0001-0001-000000000002', name: 'Soporte técnico de primer nivel', description: 'Asistencia in-situ o remota al usuario',   sla_hours: 4,  approval_required: 0, approver_role: null,            form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000005', category_id: '22222222-0001-0001-0001-000000000002', name: 'Préstamo de equipos',             description: 'Préstamo temporal de laptops o periféricos', sla_hours: 2, approval_required: 1, approver_role: 'administrador', form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000006', category_id: '22222222-0001-0001-0001-000000000002', name: 'Instalación de software',         description: 'Instalación y licenciamiento de software',  sla_hours: 8, approval_required: 0, approver_role: null,            form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        // Aplicaciones y Software
        { id: '33333333-0001-0001-0001-000000000007', category_id: '22222222-0001-0001-0001-000000000003', name: 'Acceso a aplicación',             description: 'Alta de usuario en sistema corporativo',    sla_hours: 8,  approval_required: 1, approver_role: 'administrador', form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000008', category_id: '22222222-0001-0001-0001-000000000003', name: 'Reporte de error en aplicación',  description: 'Registro y seguimiento de bugs en apps',   sla_hours: 4,  approval_required: 0, approver_role: null,            form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        // Seguridad
        { id: '33333333-0001-0001-0001-000000000009', category_id: '22222222-0001-0001-0001-000000000004', name: 'Creación de cuenta de usuario',   description: 'Alta y configuración de cuenta corporativa', sla_hours: 4, approval_required: 1, approver_role: 'administrador', form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000010', category_id: '22222222-0001-0001-0001-000000000004', name: 'Restablecimiento de contraseña',  description: 'Reset de password o desbloqueo de cuenta',  sla_hours: 1,  approval_required: 0, approver_role: null,            form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
        { id: '33333333-0001-0001-0001-000000000011', category_id: '22222222-0001-0001-0001-000000000004', name: 'Revisión de permisos y accesos',  description: 'Auditoría y ajuste de permisos',            sla_hours: 8,  approval_required: 1, approver_role: 'administrador', form_schema: null, is_active: 1, created_at: new Date(), updated_at: new Date(), deleted_at: null },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('services').catch(() => {});
    await queryInterface.dropTable('service_categories').catch(() => {});
    await queryInterface.dropTable('ci_relationships').catch(() => {});
    await queryInterface.dropTable('config_items').catch(() => {});
    await queryInterface.dropTable('ci_types').catch(() => {});
    await queryInterface.dropTable('known_errors').catch(() => {});
  },
};

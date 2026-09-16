'use strict';

module.exports = {
  async up(queryInterface, DataTypes) {
    const tables = await queryInterface.showAllTables();
    const has = (t) => tables.includes(t);

    // ── itsm_categories ───────────────────────────────────────────────────────
    if (!has('itsm_categories')) {
      await queryInterface.createTable('itsm_categories', {
        id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre:     { type: DataTypes.STRING(100), allowNull: false, unique: true },
        area:       { type: DataTypes.STRING(100), allowNull: true,  defaultValue: null },
        activo:     { type: DataTypes.BOOLEAN,     allowNull: false, defaultValue: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.bulkInsert('itsm_categories', [
        { nombre: 'Hardware',          area: 'Soporte',        activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Software',          area: 'Soporte',        activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Redes',             area: 'Infraestructura',activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Accesos',           area: 'Seguridad',      activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Correo',            area: 'Soporte',        activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Impresoras',        area: 'Soporte',        activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Aplicaciones',      area: 'Desarrollo',     activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Telefonía',         area: 'Infraestructura',activo: 1, created_at: new Date(), updated_at: new Date() },
        { nombre: 'Otro',              area: null,             activo: 1, created_at: new Date(), updated_at: new Date() },
      ]);
    }

    // ── sla_policies ──────────────────────────────────────────────────────────
    if (!has('sla_policies')) {
      await queryInterface.createTable('sla_policies', {
        id:                 { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        prioridad:          { type: DataTypes.ENUM('P1','P2','P3','P4'), allowNull: false, unique: true },
        tiempo_respuesta_h: { type: DataTypes.DECIMAL(5,2), allowNull: false },
        tiempo_resolucion_h:{ type: DataTypes.DECIMAL(5,2), allowNull: false },
        created_at:         { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at:         { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.bulkInsert('sla_policies', [
        { prioridad: 'P1', tiempo_respuesta_h: 1,  tiempo_resolucion_h: 4,  created_at: new Date(), updated_at: new Date() },
        { prioridad: 'P2', tiempo_respuesta_h: 2,  tiempo_resolucion_h: 8,  created_at: new Date(), updated_at: new Date() },
        { prioridad: 'P3', tiempo_respuesta_h: 4,  tiempo_resolucion_h: 24, created_at: new Date(), updated_at: new Date() },
        { prioridad: 'P4', tiempo_respuesta_h: 8,  tiempo_resolucion_h: 48, created_at: new Date(), updated_at: new Date() },
      ]);
    }

    // ── ticket_comments ───────────────────────────────────────────────────────
    if (!has('ticket_comments')) {
      await queryInterface.createTable('ticket_comments', {
        id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        ticket_id:  { type: DataTypes.CHAR(36), allowNull: false },
        user_id:    { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
        contenido:  { type: DataTypes.TEXT, allowNull: false },
        tipo:       {
          type: DataTypes.ENUM('comentario','cambio_estado','asignacion','sistema'),
          allowNull: false, defaultValue: 'comentario',
        },
        metadata:   { type: DataTypes.JSON, allowNull: true, defaultValue: null },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
    }

    // ── ticket_attachments ────────────────────────────────────────────────────
    if (!has('ticket_attachments')) {
      await queryInterface.createTable('ticket_attachments', {
        id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        ticket_id:  { type: DataTypes.CHAR(36), allowNull: false },
        user_id:    { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
        filename:   { type: DataTypes.STRING(255), allowNull: false },
        original:   { type: DataTypes.STRING(255), allowNull: false },
        mimetype:   { type: DataTypes.STRING(100), allowNull: true },
        size_bytes: { type: DataTypes.INTEGER, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
    }

    // ── ticket_surveys ────────────────────────────────────────────────────────
    if (!has('ticket_surveys')) {
      await queryInterface.createTable('ticket_surveys', {
        id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        ticket_id:  { type: DataTypes.CHAR(36), allowNull: false, unique: true },
        user_id:    { type: DataTypes.CHAR(36), allowNull: false },
        rating:     { type: DataTypes.TINYINT,  allowNull: false },
        comment:    { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
        skipped:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
    }

    // ── approval_flows ────────────────────────────────────────────────────────
    if (!has('approval_flows')) {
      await queryInterface.createTable('approval_flows', {
        id:                   { type: DataTypes.CHAR(36), primaryKey: true },
        workflow_instance_id: { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
        step_id:              { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        service_request_id:   { type: DataTypes.CHAR(36), allowNull: false },
        approver_id:          { type: DataTypes.CHAR(36), allowNull: false },
        step_order:           { type: DataTypes.INTEGER, defaultValue: 1 },
        status:               {
          type: DataTypes.ENUM('pendiente','aprobado','rechazado'),
          defaultValue: 'pendiente',
        },
        comments:   { type: DataTypes.TEXT, allowNull: true },
        decided_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.literal('CURRENT_TIMESTAMP') },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('approval_flows').catch(() => {});
    await queryInterface.dropTable('ticket_surveys').catch(() => {});
    await queryInterface.dropTable('ticket_attachments').catch(() => {});
    await queryInterface.dropTable('ticket_comments').catch(() => {});
    await queryInterface.dropTable('sla_policies').catch(() => {});
    await queryInterface.dropTable('itsm_categories').catch(() => {});
  },
};

'use strict';
// Crea las tablas ITSM core que no fueron generadas por migraciones anteriores.
// Debe ejecutarse antes de las migraciones 0010-0013 que agregan tenant_id a estas tablas.
const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const exists = async (t) => (await queryInterface.showAllTables()).includes(t);

    // ── tickets ───────────────────────────────────────────────────────────────
    if (!await exists('tickets')) {
      await queryInterface.createTable('tickets', {
        id:          { type: DataTypes.UUID,    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        titulo:      { type: DataTypes.STRING(255), allowNull: false },
        descripcion: { type: DataTypes.TEXT,    allowNull: true },
        tipo:        { type: DataTypes.ENUM('incidente','solicitud','cambio','problema'), allowNull: false, defaultValue: 'incidente' },
        status:      { type: DataTypes.ENUM('abierto','en_progreso','pendiente','resuelto','cerrado'), allowNull: false, defaultValue: 'abierto' },
        priority:    { type: DataTypes.ENUM('P1','P2','P3','P4'), allowNull: false, defaultValue: 'P3' },
        category_id: { type: DataTypes.INTEGER, allowNull: true },
        assigned_to: { type: DataTypes.CHAR(36), allowNull: true },
        created_by:  { type: DataTypes.CHAR(36), allowNull: true },
        sla_status:  { type: DataTypes.ENUM('ok','riesgo','vencido'), allowNull: false, defaultValue: 'ok' },
        sla_due_at:  { type: DataTypes.DATE, allowNull: true },
        resolved_at: { type: DataTypes.DATE, allowNull: true },
        closed_at:   { type: DataTypes.DATE, allowNull: true },
        metadata:    { type: DataTypes.JSON, allowNull: true },
        ai_summary:  { type: DataTypes.STRING(500), allowNull: true },
        ai_keywords: { type: DataTypes.STRING(500), allowNull: true },
        created_at:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        deleted_at:  { type: DataTypes.DATE, allowNull: true },
      });
    }

    // ── service_requests ──────────────────────────────────────────────────────
    if (!await exists('service_requests')) {
      await queryInterface.createTable('service_requests', {
        id:              { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        ticket_id:       { type: DataTypes.CHAR(36), allowNull: true },
        requester_id:    { type: DataTypes.CHAR(36), allowNull: false },
        service_id:      { type: DataTypes.CHAR(36), allowNull: true },
        title:           { type: DataTypes.STRING(255), allowNull: false },
        description:     { type: DataTypes.TEXT, allowNull: true },
        status:          { type: DataTypes.ENUM('borrador','pendiente_aprobacion','aprobado','en_proceso','completado','rechazado','cancelado'), defaultValue: 'borrador' },
        priority:        { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
        due_date:        { type: DataTypes.DATE, allowNull: true },
        completed_at:    { type: DataTypes.DATE, allowNull: true },
        rejected_reason: { type: DataTypes.TEXT, allowNull: true },
        requester_email: { type: DataTypes.STRING(255), allowNull: true },
        created_at:      { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at:      { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        deleted_at:      { type: DataTypes.DATE, allowNull: true },
      });
    }

    // ── changes ───────────────────────────────────────────────────────────────
    if (!await exists('changes')) {
      await queryInterface.createTable('changes', {
        id:                   { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        change_number:        { type: DataTypes.STRING(30), allowNull: false, unique: true },
        title:                { type: DataTypes.STRING(255), allowNull: false },
        description:          { type: DataTypes.TEXT, allowNull: true },
        type:                 { type: DataTypes.ENUM('normal','estandar','emergencia'), defaultValue: 'normal' },
        status:               { type: DataTypes.ENUM('borrador','pendiente_aprobacion','aprobado','en_implementacion','implementado','cancelado'), defaultValue: 'borrador' },
        priority:             { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
        risk_level:           { type: DataTypes.ENUM('bajo','medio','alto','critico'), defaultValue: 'medio' },
        requested_by:         { type: DataTypes.CHAR(36), allowNull: false },
        assigned_to:          { type: DataTypes.CHAR(36), allowNull: true },
        planned_start:        { type: DataTypes.DATE, allowNull: true },
        planned_end:          { type: DataTypes.DATE, allowNull: true },
        actual_start:         { type: DataTypes.DATE, allowNull: true },
        actual_end:           { type: DataTypes.DATE, allowNull: true },
        rollback_plan:        { type: DataTypes.TEXT, allowNull: true },
        test_plan:            { type: DataTypes.TEXT, allowNull: true },
        implementation_notes: { type: DataTypes.TEXT, allowNull: true },
        post_impl_review:     { type: DataTypes.TEXT, allowNull: true },
        cab_approved_at:      { type: DataTypes.DATE, allowNull: true },
        cab_approved_by:      { type: DataTypes.CHAR(36), allowNull: true },
        created_at:           { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at:           { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        deleted_at:           { type: DataTypes.DATE, allowNull: true },
      });
    }

    // ── problems ──────────────────────────────────────────────────────────────
    if (!await exists('problems')) {
      await queryInterface.createTable('problems', {
        id:             { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        problem_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
        title:          { type: DataTypes.STRING(255), allowNull: false },
        description:    { type: DataTypes.TEXT, allowNull: true },
        status:         { type: DataTypes.ENUM('abierto','en_investigacion','conocido','resuelto','cerrado'), defaultValue: 'abierto' },
        priority:       { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
        assigned_to:    { type: DataTypes.CHAR(36), allowNull: true },
        root_cause:     { type: DataTypes.TEXT, allowNull: true },
        workaround:     { type: DataTypes.TEXT, allowNull: true },
        resolution:     { type: DataTypes.TEXT, allowNull: true },
        resolved_at:    { type: DataTypes.DATE, allowNull: true },
        created_at:     { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at:     { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        deleted_at:     { type: DataTypes.DATE, allowNull: true },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('problems').catch(() => {});
    await queryInterface.dropTable('changes').catch(() => {});
    await queryInterface.dropTable('service_requests').catch(() => {});
    await queryInterface.dropTable('tickets').catch(() => {});
  },
};

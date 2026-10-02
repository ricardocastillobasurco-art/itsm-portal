'use strict';

// Catálogos de cierre por empresa (TicketCatalogService).
// Las opciones que estaban fijas en el formulario de cierre (propias de la
// empresa dueña) se guardan como catálogo de la empresa 1, solo si es una
// instalación que ya las usaba; el resto de empresas recibe la lista genérica.
// Idempotente.

const OWNER = {
  resolucion: ['Resuelto', 'Reinicio de servicio', 'Aplicación de workaround', 'Orientación al usuario',
               'Sin acción correctiva', 'Ticket duplicado', 'Cese de alarma', 'Resueltos por tren',
               'Desarrollo de Hotfix', 'Cierre masivo'],
  proceso:    ['WORKPLACE', 'PLATAFORMAS', 'LOGIN APP MIMOVISTAR', 'ECOMMERCE', 'VENTAS MOVIL', 'VENTAS FIJA',
               'AVERÍAS', 'RECLAMOS', 'ALERTA P1', 'PORT IN', 'PORT OUT', 'JIRA', 'SISTEMAS', 'INFRAESTRUCTURA'],
  resultado: [
    ['Workplace',          ['Workplace', 'Sin acción - Orden completada', 'Sin acción - Orden cancelada']],
    ['Amdocs',             ['Cambio en Amdocs', 'Asociado a Drop']],
    ['Infraestructura',    ['Intermitencia', 'Automatismo', 'Asociado a Drop']],
    ['Automatismo',        ['Automatismo']],
    ['Otros',              ['Otros']],
    ['Asociado a PaP',     ['Asociado a PaP']],
    ['Deuda técnica',      ['Deuda técnica', 'GAP funcional', 'Inconsistencia de datos', 'Operativa de usuario']],
    ['Resuelto en N3',     ['Resuelto en N3']],
    ['Seguridad',          ['Seguridad']],
    ['Servicios Externos', ['Equifax', 'Reniec', 'Portabilidad']],
  ],
};

module.exports = {
  OWNER,
  async up(queryInterface) {
    const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
    const tables = new Set(await queryInterface.showAllTables());

    if (!tables.has('ticket_catalog_options')) {
      await q(`CREATE TABLE ticket_catalog_options (
                 id           INT AUTO_INCREMENT PRIMARY KEY,
                 tenant_id    INT NOT NULL,
                 catalog_key  VARCHAR(40)  NOT NULL,
                 value        VARCHAR(150) NOT NULL,
                 parent_value VARCHAR(150) NOT NULL DEFAULT '',
                 sort_order   INT NOT NULL DEFAULT 0,
                 created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                 UNIQUE KEY uq_tco (tenant_id, catalog_key, parent_value, value),
                 KEY idx_tco_tenant (tenant_id, catalog_key)
               ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    // Tipo de resolución y proceso elegidos al cerrar un ticket local (para reportes)
    if (tables.has('jira_tickets')) {
      const cols = await queryInterface.describeTable('jira_tickets');
      if (!cols.resolution_type)  await q('ALTER TABLE jira_tickets ADD COLUMN resolution_type VARCHAR(150) NULL');
      if (!cols.process_impacted) await q('ALTER TABLE jira_tickets ADD COLUMN process_impacted VARCHAR(150) NULL');
    }

    if (!tables.has('itsm_automations') || !tables.has('tenants')) return;

    // ¿La empresa 1 ya usaba estas opciones? (instalación existente de la empresa dueña)
    const [[owner]] = await q("SELECT slug FROM tenants WHERE id = 1");
    let usedBefore = /integratel/i.test(owner?.slug || '');
    if (!usedBefore && tables.has('jira_tickets')) {
      const [[r]] = await q("SELECT COUNT(*) AS n FROM jira_tickets WHERE COALESCE(tenant_id, 1) = 1 AND wp_resultado_padre IS NOT NULL");
      usedBefore = Number(r?.n) > 0;
    }
    if (!usedBefore) return;

    const [[cfg]] = await q("SELECT COUNT(*) AS n FROM itsm_automations WHERE tenant_id = 1 AND `key` = 'close_catalogs_configured'");
    if (Number(cfg?.n) > 0) return;

    const rows = [];
    OWNER.resolucion.forEach((v, i) => rows.push(['resolucion', v, '', i]));
    OWNER.proceso.forEach((v, i) => rows.push(['proceso', v, '', i]));
    OWNER.resultado.forEach(([p, kids], i) => {
      rows.push(['resultado', p, '', i]);
      kids.forEach((c, j) => rows.push(['resultado', c, p, j]));
    });
    await q(`INSERT IGNORE INTO ticket_catalog_options (tenant_id, catalog_key, value, parent_value, sort_order)
             VALUES ${rows.map(() => '(1, ?, ?, ?, ?)').join(', ')}`, rows.flat());
    await q(`INSERT INTO itsm_automations (tenant_id, \`key\`, value) VALUES (1, 'close_ask_masiva', '1'), (1, 'close_catalogs_configured', '1')
             ON DUPLICATE KEY UPDATE value = VALUES(value)`);
  },
  async down() {},
};

'use strict';

// RMM multiempresa: ninguna empresa ve equipos de MeshCentral que no tenga asignados.
// Antes, la empresa 1 veía TODOS los equipos del servidor mientras no tuviera grupos.
//
// Para que la empresa 1 no pierda nada con ese cambio: si hoy usa el MeshCentral de
// la plataforma SIN grupos asignados, ese mismo servidor pasa a ser su "servidor
// propio" (integración rmm_dedicado), con el que sigue viendo todos sus equipos.
// El superadmin puede luego cambiar el servidor compartido sin afectarla.
// Idempotente; no hace nada si no había MeshCentral configurado.

module.exports = {
  async up(queryInterface) {
    const q = (sql, p) => queryInterface.sequelize.query(sql, { replacements: p });
    const tables = new Set(await queryInterface.showAllTables());
    if (!tables.has('tenant_features') || !tables.has('rmm_tenant_groups')) return;

    const [[groups]] = await q('SELECT COUNT(*) AS n FROM rmm_tenant_groups WHERE tenant_id = 1');
    if (Number(groups.n) > 0) return;
    const [[has]] = await q("SELECT COUNT(*) AS n FROM tenant_features WHERE tenant_id = 1 AND name = 'rmm_dedicado'");
    if (Number(has.n) > 0) return;

    // Configuración actual del servidor de la plataforma: panel (rmm_settings) o .env
    const { decrypt, sealConfig } = require('../utils/secretBox');
    let m = {};
    if (tables.has('rmm_settings')) {
      const [rows] = await q('SELECT `key`, value FROM rmm_settings');
      m = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
    }
    const open = (v) => { try { return decrypt(v) || ''; } catch (_) { return ''; } };
    const cfg = {
      base_url:     m.mesh_url || process.env.MESHCENTRAL_URL || '',
      public_url:   m.mesh_public_url || process.env.MESHCENTRAL_PUBLIC_URL || '',
      username:     m.mesh_user || process.env.MESHCENTRAL_USER || '',
      mesh_pass:    open(m.mesh_pass) || process.env.MESHCENTRAL_PASS || '',
      login_secret: open(m.mesh_login_key) || process.env.MESHCENTRAL_LOGIN_KEY || '',
    };
    if (!cfg.base_url || !cfg.username || !cfg.mesh_pass) return;   // no había RMM en uso

    await q(`INSERT INTO tenant_features (tenant_id, name, enabled, config, created_at, updated_at)
             VALUES (1, 'rmm_dedicado', 1, ?, NOW(), NOW())`, [JSON.stringify(sealConfig(cfg))]);
  },
  async down() {},
};

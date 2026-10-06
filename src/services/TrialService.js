'use strict';

// Prueba gratuita: avisos antes de que termine y paso automático al plan Gratis
// (sin perder datos). Lo ejecuta src/jobs/trialJob.js cada hora.

const { executeQuery, equipmentPool } = require('../../config/database');
const logger = require('../utils/logger');

const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);
const REMINDER_DAYS = [7, 3, 1];

async function admins(tid) {
  return q(`SELECT email, full_name FROM users WHERE COALESCE(tenant_id, 1) = ? AND role IN ('administrador', 'admin')
            AND is_active = 1 AND deleted_at IS NULL`, [tid]);
}

async function mail(tid, subject, vars) {
  const { enqueueEmail } = require('../queues/index');
  const brand = (await require('./PlatformSettings').get('brand_name')) || 'Portal TI';
  for (const a of await admins(tid)) {
    await enqueueEmail({ to: a.email, subject, template: 'plan-aviso', vars: { name: a.full_name, brand, ...vars } }).catch(() => {});
  }
}

async function run() {
  let reminded = 0, converted = 0;
  // 1. Recordatorios a 7, 3 y 1 día (una sola vez cada uno)
  const trials = await q(`SELECT id, name, settings, trial_ends_at, CEIL(TIMESTAMPDIFF(SECOND, NOW(), trial_ends_at) / 86400) AS days
                          FROM tenants WHERE plan = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at > NOW() AND id <> 1`);
  for (const t of trials) {
    const days = Number(t.days);
    // El umbral más cercano: con 2 días restantes corresponde el aviso de 3 (no el de 7)
    const due = [...REMINDER_DAYS].sort((a, b) => a - b).find(d => days <= d);
    if (!due) continue;
    let sent = [];
    try { sent = (JSON.parse(t.settings || '{}').trialReminders) || []; } catch (_) {}
    if (sent.includes(due)) continue;
    await mail(t.id, days <= 1 ? 'Tu prueba termina mañana' : `Te quedan ${days} días de prueba`,
      { kind: 'reminder', company: t.name, days });
    // JSON_EXTRACT(texto, '$') convierte el texto en JSON (vale en MySQL 8 y MariaDB)
    await q(`UPDATE tenants SET settings = JSON_SET(COALESCE(settings, '{}'), '$.trialReminders', JSON_EXTRACT(?, '$')) WHERE id = ?`,
      [JSON.stringify([...sent, due]), t.id]);
    reminded++;
  }

  // 2. Prueba vencida → plan Gratis (los datos se conservan)
  const expired = await q(`SELECT id, name FROM tenants WHERE plan = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at <= NOW() AND id <> 1`);
  for (const t of expired) {
    await q(`UPDATE tenants SET plan = 'free', updated_at = NOW() WHERE id = ? AND plan = 'trial'`, [t.id]);
    require('../repositories/platform/TenantRepository').invalidate(t.id);
    await require('./FeatureFlagService').invalidate(t.id).catch(() => {});
    require('./PlanService').invalidate(t.id);
    await q(`INSERT INTO tenant_audit_log (tenant_id, event, actor_id, metadata, created_at) VALUES (?, 'tenant.trial_ended', NULL, '{"to":"free"}', NOW())`, [t.id]).catch(() => {});
    await mail(t.id, 'Tu prueba terminó: sigues en el plan Gratis', { kind: 'ended', company: t.name });
    converted++;
  }
  if (reminded || converted) logger.info(`[prueba] ${reminded} recordatorio(s), ${converted} empresa(s) pasaron a Gratis`);
  return { reminded, converted };
}

module.exports = { run, REMINDER_DAYS };

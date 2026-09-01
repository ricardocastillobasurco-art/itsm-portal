#!/usr/bin/env node
/**
 * provision-tenant.js — Crea un nuevo tenant con todos sus datos base.
 *
 * Uso:
 *   node scripts/utilities/provision-tenant.js \
 *     --slug acme \
 *     --name "ACME Corp" \
 *     --plan professional \
 *     --admin-email ti@acme.com \
 *     --admin-pass "CambiarEnPrimerLogin!"
 *
 * Plans: trial | starter | professional | enterprise
 */
'use strict';

require('dotenv').config();
const bcrypt    = require('bcryptjs');
const sequelize = require('../../src/config/database');

// ── Parsear argumentos CLI ─────────────────────────────────────────────────

const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1];
});

const slug       = args['slug'];
const name       = args['name'];
const plan       = args['plan']        || 'starter';
const adminEmail = args['admin-email'];
const adminPass  = args['admin-pass']  || 'CambiarEnPrimerLogin!';

if (!slug || !name || !adminEmail) {
  console.error('❌  Uso: node provision-tenant.js --slug <slug> --name <name> --admin-email <email> [--plan starter] [--admin-pass <pass>]');
  process.exit(1);
}

// ── Features por plan ──────────────────────────────────────────────────────

const PLAN_FEATURES = {
  trial:        { knowledge: true,  cmdb: false, ai: false, workflows: false, branding: false },
  starter:      { knowledge: true,  cmdb: false, ai: true,  workflows: true,  branding: false },
  professional: { knowledge: true,  cmdb: true,  ai: true,  workflows: true,  branding: true  },
  enterprise:   { knowledge: true,  cmdb: true,  ai: true,  workflows: true,  branding: true  },
};

// ── Main ───────────────────────────────────────────────────────────────────

async function provision() {
  const t = await sequelize.transaction();

  try {
    const qi = sequelize.getQueryInterface();

    // 1. Crear tenant
    console.log(`\n🏢  Creando tenant "${name}" (${slug}) — plan ${plan}...`);
    const [result] = await sequelize.query(
      'INSERT INTO tenants (slug, name, plan, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(), NOW())',
      { replacements: [slug, name, plan], transaction: t }
    );
    const tenantId = result;
    console.log(`   tenant_id = ${tenantId}`);

    // 2. SLA policies por defecto
    console.log('📋  Creando SLA policies...');
    const slas = [
      ['Crítico P1', 'P1', 1,  4],
      ['Alto P2',    'P2', 4,  8],
      ['Medio P3',   'P3', 8,  24],
      ['Bajo P4',    'P4', 24, 72],
    ];
    for (const [nombre, prioridad, respH, resolH] of slas) {
      await sequelize.query(
        'INSERT INTO sla_policies (tenant_id, prioridad, tiempo_respuesta_h, tiempo_resolucion_h, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        { replacements: [tenantId, prioridad, respH, resolH], transaction: t }
      );
    }

    // 3. Categorías base de tickets
    console.log('🏷️   Creando categorías de tickets...');

    // Detectar columnas reales de ticket_categories
    const cols = await sequelize.query('SHOW COLUMNS FROM ticket_categories', { type: 'SELECT', transaction: t });
    const colNames = cols.map(c => c.Field);
    const hasTenantId = colNames.includes('tenant_id');
    const hasName     = colNames.includes('name');
    const hasNombre   = colNames.includes('nombre');
    const nameCol     = hasName ? 'name' : (hasNombre ? 'nombre' : null);

    if (nameCol && hasTenantId) {
      const cats = ['Hardware', 'Software', 'Red y Conectividad', 'Accesos y Seguridad', 'Otros'];
      for (const cat of cats) {
        await sequelize.query(
          `INSERT INTO ticket_categories (${nameCol}, tenant_id, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())`,
          { replacements: [cat, tenantId], transaction: t }
        );
      }
    } else if (nameCol) {
      // tabla sin tenant_id aún — omitir
      console.log('   ⚠️  ticket_categories sin tenant_id — omitiendo (añadir migración)');
    }

    // 4. Feature flags según plan
    console.log('🚩  Activando feature flags...');
    const features = PLAN_FEATURES[plan] || PLAN_FEATURES.starter;
    for (const [featureName, enabled] of Object.entries(features)) {
      await sequelize.query(
        'INSERT INTO tenant_features (tenant_id, name, enabled, config, created_at, updated_at) VALUES (?, ?, ?, "{}", NOW(), NOW())',
        { replacements: [tenantId, featureName, enabled ? 1 : 0], transaction: t }
      );
    }

    // 5. Usuario administrador
    console.log('👤  Creando usuario administrador...');
    const hash     = await bcrypt.hash(adminPass, 12);
    const username = `admin_${slug}`;
    const fullName = `Administrador ${name}`;
    await sequelize.query(
      'INSERT INTO users (username, email, password_hash, role, tenant_id, full_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())',
      { replacements: [username, adminEmail, hash, 'administrador', tenantId, fullName], transaction: t }
    );

    // 6. Audit log del evento
    await sequelize.query(
      'INSERT INTO tenant_audit_log (tenant_id, event, metadata, created_at) VALUES (?, ?, ?, NOW())',
      {
        replacements: [
          tenantId,
          'tenant.provisioned',
          JSON.stringify({ plan, adminEmail, provisionedBy: 'CLI', ts: new Date().toISOString() }),
        ],
        transaction: t,
      }
    );

    await t.commit();

    // ── Verificación post-provision ──────────────────────────────────────
    console.log('\n✅  Tenant provisionado exitosamente\n');
    console.log('─'.repeat(50));
    console.log(`  tenant_id   : ${tenantId}`);
    console.log(`  slug        : ${slug}`);
    console.log(`  plan        : ${plan}`);
    console.log(`  admin user  : ${username}`);
    console.log(`  admin email : ${adminEmail}`);
    console.log(`  admin pass  : ${adminPass}`);
    console.log('─'.repeat(50));

    const [slasCreated]    = await sequelize.query('SELECT COUNT(*) as n FROM sla_policies WHERE tenant_id = ?', { replacements: [tenantId], type: 'SELECT' });
    const [featsCreated]   = await sequelize.query('SELECT COUNT(*) as n FROM tenant_features WHERE tenant_id = ?', { replacements: [tenantId], type: 'SELECT' });
    const [usersCreated]   = await sequelize.query('SELECT COUNT(*) as n FROM users WHERE tenant_id = ?', { replacements: [tenantId], type: 'SELECT' });

    console.log(`\n  Verificación:`);
    console.log(`  ✓ SLA policies  : ${slasCreated.n}`);
    console.log(`  ✓ Feature flags : ${featsCreated.n}`);
    console.log(`  ✓ Usuarios      : ${usersCreated.n}`);

    console.log(`\n  Primer login:`);
    console.log(`  curl -X POST http://localhost:3000/api/auth/login \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"username":"${username}","password":"${adminPass}"}'\n`);

  } catch (err) {
    await t.rollback();
    console.error('\n❌  Error al provisionar tenant:', err.message);
    if (err.message.includes('Duplicate entry')) {
      console.error('   El slug o email ya existe en la BD.');
    }
    process.exit(1);
  }

  process.exit(0);
}

provision();

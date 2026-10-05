'use strict';

// Estructura inicial de una empresa nueva: un PAQUETE GENÉRICO definido aquí
// (políticas SLA, categorías de tickets, secciones de la base de conocimiento y
// un catálogo de servicios básico). Antes se copiaba la configuración real de la
// empresa 1, lo que trasladaba a los clientes nuevos categorías, equipos y
// correos propios de la empresa dueña.
//
// Solo llena tablas que la empresa aún tiene vacías: se puede ejecutar varias veces.
// El administrador lo ajusta luego desde el asistente de configuración.

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');

const TEMPLATE_TENANT_ID = 1;
const q = (sql, params = []) => executeQuery(equipmentPool, sql, params);

// ── Paquete inicial ──────────────────────────────────────────────────────────
const STARTER = {
  // [prioridad, respuesta (h), resolución (h)]
  sla: [['P1', 1, 4], ['P2', 2, 8], ['P3', 8, 24], ['P4', 24, 72]],

  // Categorías de incidencias (padre → hijos) con ícono Bootstrap
  categories: [
    ['Equipos', 'bi-pc-display', ['Computadora o laptop', 'Impresora', 'Periféricos (mouse, teclado, monitor)', 'Teléfono o celular']],
    ['Programas', 'bi-window-stack', ['Microsoft Office', 'Correo electrónico', 'Aplicación de la empresa', 'Instalación de programa']],
    ['Red e internet', 'bi-wifi', ['Sin internet', 'Wi-Fi', 'VPN / acceso remoto', 'Carpetas compartidas']],
    ['Accesos y cuentas', 'bi-key', ['Restablecer contraseña', 'Cuenta bloqueada', 'Permisos de acceso']],
    ['Otros', 'bi-question-circle', ['Consulta general']],
  ],

  kbCategories: [
    ['Guías de uso', 'Cómo usar los equipos y programas de la empresa', 'bi-book'],
    ['Problemas frecuentes', 'Soluciones rápidas a los problemas más comunes', 'bi-lightbulb'],
    ['Políticas de TI', 'Normas de uso, seguridad y contraseñas', 'bi-shield-check'],
  ],

  // [categoría, ícono, [[servicio, descripción, horas SLA, requiere aprobación]]]
  services: [
    ['Equipos', 'bi-laptop', [
      ['Solicitud de equipo nuevo', 'Laptop, monitor u otro equipo para un colaborador', 72, true],
      ['Préstamo de equipo', 'Equipo temporal (proyector, laptop de reemplazo)', 24, false],
    ]],
    ['Accesos', 'bi-person-badge', [
      ['Alta de usuario nuevo', 'Cuenta, correo y accesos para un colaborador que ingresa', 24, true],
      ['Acceso a sistema o carpeta', 'Permiso para un sistema, carpeta o aplicación', 24, true],
      ['Baja de usuario', 'Desactivar accesos de un colaborador que se retira', 8, false],
    ]],
    ['Programas', 'bi-download', [
      ['Instalación de programa', 'Instalar un programa licenciado o gratuito autorizado', 48, false],
    ]],
  ],
};

async function tableExists(table) {
  const [r] = await q('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]);
  return Number(r.n) > 0;
}

async function isEmptyFor(table, tid) {
  const [r] = await q(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE tenant_id = ?`, [tid]);
  return Number(r.n) === 0;
}

async function ready(table, tid) {
  return (await tableExists(table)) && (await isEmptyFor(table, tid));
}

async function seedSla(tid) {
  if (!(await ready('sla_policies', tid))) return 0;
  for (const [p, resp, resol] of STARTER.sla) {
    await q(`INSERT INTO sla_policies (tenant_id, prioridad, tiempo_respuesta_h, tiempo_resolucion_h, created_at, updated_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())`, [tid, p, resp, resol]);
  }
  return STARTER.sla.length;
}

async function seedTicketCategories(tid) {
  if (!(await ready('ticket_categories', tid))) return 0;
  let n = 0;
  for (const [i, [name, icon, children]] of STARTER.categories.entries()) {
    const r = await q(`INSERT INTO ticket_categories (tenant_id, parent_id, name, icon, sort_order, is_active, created_at)
                       VALUES (?, NULL, ?, ?, ?, 1, NOW())`, [tid, name, icon, i]);
    n++;
    for (const [j, child] of children.entries()) {
      await q(`INSERT INTO ticket_categories (tenant_id, parent_id, name, icon, sort_order, is_active, created_at)
               VALUES (?, ?, ?, ?, ?, 1, NOW())`, [tid, r.insertId, child, icon, j]);
      n++;
    }
  }
  return n;
}

async function seedKbCategories(tid) {
  if (!(await ready('kb_categories', tid))) return 0;
  for (const [i, [name, description, icon]] of STARTER.kbCategories.entries()) {
    await q(`INSERT INTO kb_categories (id, tenant_id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`, [crypto.randomUUID(), tid, name, description, icon, i]);
  }
  return STARTER.kbCategories.length;
}

async function seedServices(tid) {
  if (!(await ready('service_categories', tid))) return 0;
  const withServices = await tableExists('services') && await isEmptyFor('services', tid);
  let n = 0;
  for (const [catName, icon, items] of STARTER.services) {
    const catId = crypto.randomUUID();
    await q(`INSERT INTO service_categories (id, tenant_id, name, icon, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, NOW(), NOW())`, [catId, tid, catName, icon]);
    if (!withServices) continue;
    for (const [name, description, hours, approval] of items) {
      await q(`INSERT INTO services (id, tenant_id, category_id, name, description, sla_hours, approval_required, approver_role, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [crypto.randomUUID(), tid, catId, name, description, hours, approval ? 1 : 0, approval ? 'administrador' : null]);
      n++;
    }
  }
  return n;
}

// Nombre histórico (lo llama el flujo de alta del superadmin)
async function copyBaseStructure(tenantId) {
  const tid = Number(tenantId);
  if (!tid || tid === TEMPLATE_TENANT_ID) throw new Error('Tenant destino inválido');
  return {
    sla_policies:      await seedSla(tid),
    ticket_categories: await seedTicketCategories(tid),
    kb_categories:     await seedKbCategories(tid),
    services:          await seedServices(tid),
  };
}

module.exports = { copyBaseStructure, seedStarterPack: copyBaseStructure, STARTER, TEMPLATE_TENANT_ID };

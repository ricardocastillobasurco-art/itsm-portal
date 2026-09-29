'use strict';

// ============================================================================
// Catálogo comercial: módulos y planes.
// Para cambiar qué incluye cada plan, edita PLANS. Para dar un módulo extra a
// un cliente puntual (add-on), agrega su clave en tenants.settings.extraModules.
// ============================================================================

const MODULES = {
    helpdesk:        { label: 'Mesa de ayuda',        description: 'Incidencias, requerimientos, catálogo, portal de autoservicio, base de conocimiento y FAQ' },
    itsm_avanzado:   { label: 'ITSM avanzado',        description: 'Gestión de problemas, cambios y mejora continua (CSI)' },
    activos:         { label: 'Gestión de activos',   description: 'Inventario/CMDB, asignaciones, almacén, garantías, devoluciones y soporte' },
    reportes:        { label: 'Reportería',           description: 'Indicadores KPI, reportes ITSM y envío programado de reportes' },
    impresion:       { label: 'Cola de impresión',    description: 'Gestión de solicitudes de impresión' },
    licencias_m365:  { label: 'Licencias M365',       description: 'Costos, uso y recomendaciones de ahorro de licencias Microsoft 365' },
    microsoft:       { label: 'Microsoft 365 + Intune', description: 'Panel de dispositivos Intune, BitLocker, LAPS, Active Directory y sincronización Outlook' },
    rmm:             { label: 'Control remoto (RMM)', description: 'Monitoreo y acceso remoto a equipos con MeshCentral' },
};

const ALL_MODULES = Object.keys(MODULES);

const PLANS = {
    trial:        { label: 'Prueba',       modules: ALL_MODULES },
    starter:      { label: 'Starter',      modules: ['helpdesk'] },
    professional: { label: 'Profesional',  modules: ['helpdesk', 'itsm_avanzado', 'activos', 'reportes', 'impresion', 'licencias_m365'] },
    enterprise:   { label: 'Enterprise',   modules: ALL_MODULES },
};

// El tenant 1 es la instalación original: conserva todos los módulos
// independientemente del plan registrado.
const OWNER_TENANT_ID = 1;

function modulesForTenant(tenant) {
    const id = tenant?.id ?? OWNER_TENANT_ID;
    if (id === OWNER_TENANT_ID) return new Set(ALL_MODULES);

    // Plan desconocido o vacío = prueba (no se le quita nada a un cliente mal configurado)
    const plan  = PLANS[tenant?.plan] || PLANS.trial;
    const extra = Array.isArray(tenant?.settings?.extraModules) ? tenant.settings.extraModules : [];
    return new Set([...plan.modules, ...extra.filter(m => MODULES[m])]);
}

function hasModule(tenant, moduleKey) {
    return modulesForTenant(tenant).has(moduleKey);
}

module.exports = { MODULES, PLANS, ALL_MODULES, OWNER_TENANT_ID, modulesForTenant, hasModule };

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
    // ownerOnly: aún depende de la infraestructura del tenant dueño (buzón, AD, impresoras);
    // no se entrega a clientes aunque esté en su plan, hasta que se adapte a multi-empresa.
    impresion:       { label: 'Cola de impresión',    description: 'Gestión de solicitudes de impresión', ownerOnly: true },
    licencias_m365:  { label: 'Licencias M365',       description: 'Costos, uso y recomendaciones de ahorro de licencias Microsoft 365' },
    microsoft:       { label: 'Microsoft 365 + Intune', description: 'Panel de dispositivos Intune, BitLocker, LAPS, Active Directory y sincronización Outlook', ownerOnly: true },
    rmm:             { label: 'Control remoto (RMM)', description: 'Monitoreo y acceso remoto a equipos con MeshCentral' },
};

const ALL_MODULES = Object.keys(MODULES);
// Módulos que se pueden vender hoy a un cliente
const SELLABLE_MODULES = ALL_MODULES.filter(k => !MODULES[k].ownerOnly);

const PLANS = {
    trial:        { label: 'Prueba',       modules: SELLABLE_MODULES },
    // Gratis: mesa de ayuda completa + control remoto con límite de equipos (ver PlanService)
    free:         { label: 'Gratis',       modules: ['helpdesk', 'rmm'] },
    starter:      { label: 'Starter',      modules: ['helpdesk'] },
    professional: { label: 'Pro',          modules: ['helpdesk', 'itsm_avanzado', 'activos', 'reportes', 'licencias_m365', 'rmm'] },
    enterprise:   { label: 'Enterprise',   modules: SELLABLE_MODULES },
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
    return new Set([...plan.modules, ...extra].filter(m => MODULES[m] && !MODULES[m].ownerOnly));
}

function hasModule(tenant, moduleKey) {
    return modulesForTenant(tenant).has(moduleKey);
}

module.exports = { MODULES, PLANS, ALL_MODULES, SELLABLE_MODULES, OWNER_TENANT_ID, modulesForTenant, hasModule };

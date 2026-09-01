# Arquitectura del Proyecto

## Stack
Node.js · Express · Sequelize (MySQL) · EJS · Socket.io · Bull · Casbin · Redis

## Dominios funcionales

| Dominio | Responsabilidad | Carpetas clave |
|---|---|---|
| **platform** | Auth, usuarios, RBAC, tenant, reglas de negocio | `routes/platform/`, `src/models/platform/`, `src/services/platform/`, `src/repositories/platform/` |
| **service-management** | Incidencias, cambios, problemas, SLA, cola de impresión | `routes/service-management/`, `src/models/service-management/` |
| **service-operations** | Catálogo de servicios, solicitudes, flujos de aprobación | `routes/service-operations/`, `src/models/service-operations/`, `src/services/service-operations/` |
| **experience** | Portal de usuario, knowledge base, FAQ, notificaciones | `routes/experience/`, `src/models/experience/` |
| **analytics** | Dashboards, reportes, CSI, indicadores | `routes/analytics/`, `src/models/analytics/` |
| **asset-management** | Equipos, CMDB, asignaciones, almacén, garantías | `routes/asset-management/`, `src/models/asset-management/` |
| **integrations** | Jira, Outlook/Graph, Active Directory, herramientas | `routes/integrations/`, `src/services/integrations/`, `src/models/integrations/` |

## Convención para nueva funcionalidad

```
1. Modelo       → src/models/<dominio>/NombreModelo.js
2. Migración    → src/migrations/<timestamp>-descripcion.js
3. Repositorio  → src/repositories/<dominio>/NombreRepository.js  (si acceso a DB reutilizable)
4. Service      → src/services/<dominio>/NombreService.js          (lógica de negocio)
5. Route        → routes/<dominio>/nombre.js
6. Vista        → views/<dominio>/nombre.ejs
7. Registrar    → routes/api.js  (API) o  routes/views.js  (MVC)
```

## Módulos ITIL v4 — Registry
`src/modules/index.js` registra módulos con lazy-load de routers.
Cada módulo en `src/modules/<nombre>/index.js` expone: `id, name, apiPrefix, router()`.

## Archivos de infraestructura compartida

| Archivo | Qué hace |
|---|---|
| `src/utils/logger.js` | Logger Winston (canónico). `utils/logger.js` es re-export. |
| `src/utils/audit.js` | `logAudit(req, action, resource)` — escribe en AuditLog |
| `src/utils/tenantScope.js` | `tenantWhere(req)`, `addTenant(opts, req)`, `tenantId(req)` |
| `src/utils/featureFlags.js` | `hasFeature(req, feature)`, `requireFeature(feature)` middleware |
| `src/utils/response.js` | `ApiResponse.success()`, `ApiResponse.error()` |
| `middleware/casbin.js` | RBAC — policy en `src/config/rbac/` |
| `src/middlewares/tenant/` | Resolución de tenant por header/JWT/default |

## Testing

```
tests/
├── unit/
│   ├── utils/          → featureFlags, tenantScope, errors, response
│   ├── repositories/   → TenantRepository cache
│   └── services/       → GraphService
└── integration/
    └── tenant-isolation.test.js
```

Ejecutar: `npm test` · Con cobertura: `npm run test:coverage`

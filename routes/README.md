# routes/

Rutas Express organizadas por dominio. El agregador principal es `api.js`.

| Carpeta | Prefijo API | Responsabilidad |
|---|---|---|
| `platform/` | `/api/auth`, `/api/employees`, `/api/permissions`, `/api/licenses`, `/api/business-rules` | Auth, usuarios, RBAC |
| `service-management/` | `/api/itsm`, `/api/changes`, `/api/problems`, `/api/print-queue` | ITSM core |
| `service-operations/` | `/api/service-requests`, `/api/catalog` | Catálogo y solicitudes |
| `experience/` | `/api/portal`, `/api/kb`, `/api/faq`, `/api/notifications` | Portal usuario |
| `analytics/` | `/api/dashboard`, `/api/indicators`, `/api/csi`, `/api/reports*` | Reportes y métricas |
| `asset-management/` | `/api/equipment`, `/api/cmdb`, `/api/assignments`, `/api/almacen`… | Activos físicos |
| `integrations/` | `/api/outlook-sync`, `/api/ad`, `/api/herramientas` | Integraciones externas |
| `jira/` | `/api/jira`, `/tickets` | Conector Jira |

Las vistas MVC están en `views.js` (renderiza EJS, no devuelve JSON).

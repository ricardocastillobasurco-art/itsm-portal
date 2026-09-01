# Documentación de Endpoints - API Jira (`/api/jira` y `/tickets`)

Esta documentación detalla los endpoints refactorizados y separados por submódulos.

## Módulo: `admin.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/employee-info` | — |
| `GET` | `/agents` | — |
| `GET` | `/technicians` | — |
| `POST` | `/specialists` | — |
| `GET` | `/specialists` | GET /api/jira/specialists — Lista de especialistas |
| `PUT` | `/specialists/:id/toggle` | PUT /api/jira/specialists/:id/toggle — Activar/desactivar |
| `GET` | `/software-catalog` | — |
| `POST` | `/software-catalog` | POST /api/jira/software-catalog — Agregar software nuevo |
| `GET` | `/categories` | — |
| `POST` | `/categories` | — |
| `PUT` | `/categories/:id` | — |
| `DELETE` | `/categories/:id` | — |
| `GET` | `/automations` | — |
| `PUT` | `/automations` | — |
| `GET` | `/admin/users` | — |
| `POST` | `/admin/users` | — |
| `PUT` | `/admin/users/:id/role` | — |
| `PUT` | `/admin/users/:id/status` | — |

## Módulo: `attachments.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `POST` | `/attachment` | — |
| `POST` | `/ticket/:key/attachments` | POST /api/jira/ticket/:key/attachments |
| `GET` | `/ticket/:key/attachments` | GET /api/jira/ticket/:key/attachments |
| `GET` | `/ticket/:key/attachments/:id/download` | GET /api/jira/ticket/:key/attachments/:id/download |
| `DELETE` | `/ticket/:key/attachments/:id` | DELETE /api/jira/ticket/:key/attachments/:id |

## Módulo: `other.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/sync` | — |

## Módulo: `portal.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/test-auth` | — |
| `GET` | `/my-tickets` | — |
| `GET` | `/my-tickets/:key` | — |
| `POST` | `/my-tickets/:key/close` | — |
| `POST` | `/my-tickets/:key/comment` | — |

## Módulo: `reports.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/stats` | — |
| `GET` | `/alerts` | — |
| `GET` | `/report` | — |
| `POST` | `/report/send-email` | — |
| `GET` | `/survey-results` | — |
| `GET` | `/survey/:token` | — |
| `POST` | `/survey/:token` | — |
| `GET` | `/kb/suggest` | — |

## Módulo: `requirements.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/requirements` | GET /api/jira/requirements |
| `POST` | `/requirement` | POST /api/jira/requirement |
| `PATCH` | `/requirement/:key` | PATCH /api/jira/requirement/:key |
| `POST` | `/requirement/:key/close` | POST /api/jira/requirement/:key/close |
| `PUT` | `/requirement/:key/take` | PUT /api/jira/requirement/:key/take |
| `GET` | `/requirements/sync` | GET /api/jira/requirements/sync |
| `GET` | `/req-stats` | GET /api/jira/req-stats |
| `GET` | `/req-fields` | GET /api/jira/req-fields — buscar proyecto del portal 1156 y workspaces de Assets |
| `GET` | `/test-close/:key` | — |

## Módulo: `tickets_jira.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/` | — |
| `GET` | `/ticket/:key/jira-detail` | — |
| `POST` | `/ticket` | — |
| `POST` | `/ticket/:key/close` | — |
| `GET` | `/survey-page/:token` | Página pública de encuesta (redirige al iframe/página de votación) |
| `GET` | `/queue/unassigned` | — |
| `GET` | `/queue/assigned` | — |
| `PUT` | `/ticket/:key/assign` | — |
| `PUT` | `/ticket/:key/assign-tech` | — |

## Módulo: `tickets_local.js`

| Método | Endpoint | Descripción Inferida |
|---|---|---|
| `GET` | `/` | — |
| `GET` | `/tickets` | — |
| `GET` | `/ticket/:key` | — |
| `PUT` | `/ticket/:key/take` | — |
| `PUT` | `/ticket/:key/internal-status` | — |
| `POST` | `/ticket/:key/comment` | — |
| `GET` | `/ticket/:key/comments` | GET /api/jira/ticket/:key/comments — Obtener comentarios (internos solo para técnicos) |
| `GET` | `/ticket/:key/history` | — |
| `PUT` | `/ticket/:key/recategorize` | — |
| `POST` | `/ticket/:key/send-email` | — |
| `POST` | `/ticket/:key/reopen` | — |


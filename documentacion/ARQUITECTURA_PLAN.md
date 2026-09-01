# Plan de Arquitectura — ITSM Multi-Tenant SaaS
> **Actualizado:** Mayo 2026 | **Estado:** Fases 0–9 completas · Hardening finalizado  
> **Audiencia:** Equipo técnico interno  
> **Próximo hito:** Cloud-ready (Fases 10–11)

---

## Resumen ejecutivo

El proyecto es una **plataforma ITSM multi-tenant** construida sobre Node.js + Express + Sequelize.
Las fases 0–7 establecieron la base técnica completa. Lo que queda antes de la nube son
aspectos operacionales: onboarding robusto, hardening de producción, CI/CD y billing.

---

## Fases completadas (0–9) — resumen compacto

| Fase | Descripción | Archivos clave |
|---|---|---|
| **0** | Base: tenant middleware, TenantBaseRepository, health probes, error handler centralizado | `src/middlewares/tenant/`, `src/repositories/`, `middleware/error-handler.js` |
| **1** | Módulos ITSM: tickets, service-requests, changes, problems, assets, knowledge | `src/modules/*/controller · service · repository · routes` |
| **2** | Event Bus: EventEmitter2 + listeners SLA, notificaciones, audit, Jira, IA, métricas | `src/core/events/` |
| **3** | Tenant Customization: feature flags Redis, custom fields, branding, tenant_id en CMDB y KB | `src/services/FeatureFlagService.js`, `src/services/ViewResolver.js` |
| **4** | Workflow Engine: aprobaciones multi-step para SR y Changes con WorkflowEngine | `src/core/workflow/WorkflowEngine.js`, `src/modules/workflow/` |
| **5** | RBAC + ABAC: Casbin por recurso/acción + Policy classes contextuales | `src/config/rbac/`, `src/core/policies/`, `src/middlewares/authorization/` |
| **6** | IA: TicketClassifier, KbSemanticSearch, ARIA chatbot (Groq) | `src/core/ai/`, `src/modules/ai/` |
| **7** | Observabilidad: Prometheus `/metrics`, Grafana dashboard, alertas SLA/errores/IA | `src/core/metrics/`, `observability/`, `docker-compose.observability.yml` |
| **8** | Tenant Lifecycle: provision-tenant CLI, suspend/reactivate, GDPR export, audit log | `scripts/utilities/provision-tenant.js`, `src/services/TenantLifecycleService.js`, `src/modules/tenant/` |
| **9** | Production Hardening: dual auth (cookie+Bearer), Nginx TLS, backup cron, rate limit por plan, validación de .env | `middleware/auth.js`, `nginx/itsm.conf`, `scripts/utilities/backup.sh`, `src/middlewares/tenant/rateLimitByTenant.js` |

---

## Evaluación SaaS-Readiness actual

### ✅ Listo

| Capacidad | Detalle |
|---|---|
| Aislamiento de datos | `TenantBaseRepository._scope()` filtra `tenant_id` en todas las queries |
| Autenticación multi-tenant | JWT + sesiones; `req.tenant` resuelto por host/header antes de cada request |
| Feature flags por tenant | Redis TTL 5min, fallback DB si Redis cae |
| Branding por tenant | `ViewResolver` → `primary_color`, `logo_url`, `custom_css` |
| Workflow configurable | Templates de aprobación por tenant y tipo de entidad |
| RBAC por rol | Casbin: administrador · especialista · agente · visor · usuario |
| ABAC contextual | Policy classes: tenant match, ownership, status de recurso |
| IA por tenant | Groq auto-clasifica tickets; ARIA adapta system prompt al tenant |
| Observabilidad | Prometheus scrape `/metrics`, Grafana con dashboard pre-cargado, alertas SLA |
| Health probes | `/health`, `/health/live`, `/health/ready` (K8s ready) |
| Rate limiting | `rateLimitByTenant` por slug de tenant |
| Audit log | `AuditLog` table + EventBus listener en cada operación sensible |

### ❌ Gaps antes de nube

| Gap | Impacto | Fase que lo resuelve |
|---|---|---|
| `tenant_id` falta en `approval_flows`, `workflow_instances` | Fugas cross-tenant en workflows | **8** |
| Sin script `provision-tenant.js` probado en producción | Onboarding manual = error humano | **8** |
| Sin suspensión/eliminación de tenant | No se puede dar de baja a un cliente | **8** |
| Sin exportación de datos por tenant (GDPR) | Riesgo legal en mercados EU | **8** |
| Auth usa solo cookies; API pública necesita Bearer JWT | Integraciones externas bloqueadas | **9** |
| Secrets en `.env` plano | No apto para producción compartida | **9** |
| Sin Nginx/TLS delante del app | Puerto 3000 expuesto directamente | **9** |
| Sin límites de recursos por plan (plan starter ≠ enterprise) | Todos los tenants tienen acceso ilimitado | **10** |
| Sin pipeline CI/CD | Deploy manual = riesgo operacional | **10** |
| Sin billing ni medición de uso | No se puede monetizar | **11** |
| Sin backup automático por tenant | Pérdida de datos ante fallo de BD | **9** |

---

## Fases pendientes antes de nube

### Fase 8 — Tenant Lifecycle (1–2 semanas)

**Objetivo:** onboarding, suspensión y borrado de tenants sin intervención manual.

#### 8.1 Migraciones pendientes

```sql
-- approval_flows: agregar tenant_id
ALTER TABLE approval_flows ADD COLUMN tenant_id INT UNSIGNED NULL AFTER id;
UPDATE approval_flows af
  JOIN changes c ON af.entity_id = c.id AND af.entity_type = 'change'
  SET af.tenant_id = c.tenant_id;

-- workflow_instances: agregar tenant_id (ya tiene en la migración 21)
-- Verificar que se ejecutó: SELECT COUNT(*) FROM workflow_instances WHERE tenant_id IS NULL;
```

#### 8.2 Script de provision de nuevo tenant

```
scripts/utilities/provision-tenant.js
```

**Pasos del script (transacción atómica):**
1. Insertar fila en `tenants` (slug, name, plan)
2. Insertar `sla_policies` por defecto (P1=4h, P2=8h, P3=24h, P4=72h)
3. Insertar `ticket_categories` base (Hardware, Software, Red, Accesos, Otros)
4. Insertar `tenant_features` iniciales (cmdb=true, knowledge=true, ai=plan!=trial)
5. Crear usuario administrador con `bcrypt.hash`
6. Log de auditoría del evento `tenant.provisioned`

**Uso:**
```bash
node scripts/utilities/provision-tenant.js \
  --slug "acme" \
  --name "ACME Corp" \
  --plan "professional" \
  --admin-email "ti@acme.com" \
  --admin-pass "CambiarEnPrimerLogin!"
```

**Verificaciones post-provision:**
```sql
SELECT id, slug, name, plan, is_active FROM tenants WHERE slug = 'acme';
SELECT * FROM sla_policies WHERE tenant_id = (SELECT id FROM tenants WHERE slug='acme');
SELECT * FROM tenant_features WHERE tenant_id = (SELECT id FROM tenants WHERE slug='acme');
SELECT id, email, role FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug='acme');
```

#### 8.3 Gestión de ciclo de vida del tenant

| Operación | Endpoint | Acción en BD |
|---|---|---|
| Suspender | `PATCH /api/admin/tenants/:id/status` `{"active": false}` | `is_active = 0` |
| Reactivar | `PATCH /api/admin/tenants/:id/status` `{"active": true}` | `is_active = 1` |
| Exportar datos | `GET /api/admin/tenants/:id/export` | ZIP con CSVs de todas las tablas con `tenant_id` |
| Eliminar | `DELETE /api/admin/tenants/:id` | Soft delete + schedule hard delete en 30 días |

#### 8.4 Middleware de tenant suspendido

```javascript
// Agregar en tenantMiddleware.js después de resolver tenant:
if (tenant && !tenant.is_active) {
  return res.status(403).json({ success: false, error: 'Tenant suspendido. Contacta soporte.' });
}
```

---

### Fase 9 — Production Hardening (1–2 semanas)

**Objetivo:** la app puede correr en un servidor compartido de forma segura.

#### 9.1 Nginx reverse proxy + TLS

```nginx
# /etc/nginx/sites-available/itsm
server {
    listen 443 ssl;
    server_name app.tudominio.com *.app.tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;

    # Resolver tenant por subdominio: acme.app.tudominio.com
    location / {
        proxy_pass         http://localhost:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Tenant-Slug     $subdomain;  # extraído por Nginx
        proxy_set_header   X-Forwarded-For   $remote_addr;
        proxy_set_header   X-Real-IP         $remote_addr;
    }
}
```

#### 9.2 Secrets management

| Actual | Producción |
|---|---|
| `.env` plano en el servidor | Variables de entorno inyectadas por el orquestador (Railway/Render/K8s) |
| `JWT_SECRET` en texto | Secret rotable en AWS Secrets Manager o Doppler |
| `GROQ_API_KEY` en `.env` | Secret store, nunca en repositorio |
| `DB_PASSWORD` en `.env` | IAM auth (RDS) o secret store |

**Regla:** `.env` es solo para desarrollo local. Nunca llega al repositorio ni al servidor de producción.

#### 9.3 Dual auth: cookies + Bearer JWT

El auth actual usa solo cookies (sesión). Las integraciones externas necesitan Bearer:

```javascript
// middleware/auth.js — leer token desde cookie O desde Authorization header
const token = req.cookies.accessToken
           || req.cookies.token
           || (req.headers.authorization?.startsWith('Bearer ')
               ? req.headers.authorization.slice(7)
               : null);
```

#### 9.4 Backup automático

```bash
# cron diario en el servidor:
0 3 * * * mysqldump -u$DB_USER -p$DB_PASS $DB_NAME | gzip > /backups/itsm_$(date +%Y%m%d).sql.gz
# Retención 30 días, subida a S3/B2
```

#### 9.5 Pool de conexiones por plan

```javascript
// src/config/database.js — ajustar pool según plan del tenant:
const POOL_SIZE = { trial: 2, starter: 5, professional: 10, enterprise: 20 };
```

---

### Fase 10 — CI/CD + DevOps (1 semana)

**Objetivo:** un `git push` dispara tests, build y deploy automático.

#### 10.1 GitHub Actions pipeline

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test        # jest o mocha
      - run: npm run lint    # eslint

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy vía SSH
        run: |
          ssh deploy@$SERVER "cd /app && git pull && npm ci --production && pm2 reload itsm"
```

#### 10.2 Migraciones automáticas en deploy

```javascript
// scripts/utilities/run-migrations.js — correr antes del arranque
const { Umzug, SequelizeStorage } = require('umzug');
const umzug = new Umzug({
  migrations: { glob: 'src/migrations/*.js' },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});
await umzug.up();
```

#### 10.3 Dockerfile optimizado (multi-stage)

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

#### 10.4 docker-compose.yml de producción

```yaml
services:
  app:
    build: .
    env_file: .env.production
    restart: unless-stopped
    depends_on: [db, redis]
    ports: ["3000:3000"]
  db:
    image: mysql:8.0
    volumes: [db_data:/var/lib/mysql]
  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]
```

---

### Fase 11 — Billing & Plan Limits (2–3 semanas)

**Objetivo:** monetizar la plataforma con planes diferenciados.

#### 11.1 Modelo de planes

| Feature | Trial | Starter | Professional | Enterprise |
|---|---|---|---|---|
| Usuarios | 3 | 10 | 50 | Ilimitado |
| Tickets/mes | 100 | 1.000 | 10.000 | Ilimitado |
| IA (clasificación) | ❌ | ✅ | ✅ | ✅ |
| Workflows | ❌ | 1 | 5 | Ilimitado |
| CMDB | ❌ | ❌ | ✅ | ✅ |
| Branding | ❌ | ❌ | ✅ | ✅ |
| SLA personalizado | ❌ | ❌ | ✅ | ✅ |
| API access | ❌ | ❌ | ✅ | ✅ |

#### 11.2 Enforcement de límites

```javascript
// src/services/PlanLimitsService.js
async function checkTicketLimit(tenantId) {
  const tenant = await Tenant.findByPk(tenantId);
  const limits = PLAN_LIMITS[tenant.plan];
  if (!limits.ticketsPerMonth) return; // ilimitado

  const thisMonth = await Ticket.count({
    where: { tenantId, createdAt: { [Op.gte]: startOfMonth() } }
  });
  if (thisMonth >= limits.ticketsPerMonth) {
    throw new ForbiddenError(`Límite de ${limits.ticketsPerMonth} tickets/mes alcanzado para tu plan ${tenant.plan}`);
  }
}
```

#### 11.3 Stripe Webhooks

```
POST /api/billing/webhook  → stripe-webhook.js
  → customer.subscription.created  → activar tenant
  → customer.subscription.deleted  → suspender tenant
  → invoice.payment_failed         → notificar admin + grace period 7 días
```

---

## Procedimiento de onboarding — estado actual (provisional)

Hasta que la Fase 8 esté completa, el proceso es semi-manual:

### Paso 1 — Crear tenant en BD

```sql
INSERT INTO tenants (slug, name, plan, is_active, created_at, updated_at)
VALUES ('acme', 'ACME Corp', 'professional', 1, NOW(), NOW());

SET @tid = LAST_INSERT_ID();
```

### Paso 2 — SLA policies por defecto

```sql
INSERT INTO sla_policies (tenant_id, nombre, prioridad, tiempo_respuesta_h, tiempo_resolucion_h, created_at, updated_at) VALUES
(@tid, 'Crítico',   'P1',  1,  4,  NOW(), NOW()),
(@tid, 'Alto',      'P2',  4,  8,  NOW(), NOW()),
(@tid, 'Medio',     'P3',  8,  24, NOW(), NOW()),
(@tid, 'Bajo',      'P4',  24, 72, NOW(), NOW());
```

### Paso 3 — Feature flags iniciales

```sql
INSERT INTO tenant_features (tenant_id, name, enabled, config, created_at, updated_at) VALUES
(@tid, 'knowledge',  1, '{}', NOW(), NOW()),
(@tid, 'cmdb',       1, '{}', NOW(), NOW()),
(@tid, 'ai',         1, '{}', NOW(), NOW()),
(@tid, 'workflows',  1, '{}', NOW(), NOW());
```

### Paso 4 — Categorías base de tickets

```sql
INSERT INTO ticket_categories (nombre, area, tenant_id, created_at, updated_at) VALUES
('Hardware',     'Soporte', @tid, NOW(), NOW()),
('Software',     'Soporte', @tid, NOW(), NOW()),
('Red',          'Soporte', @tid, NOW(), NOW()),
('Accesos',      'Seguridad', @tid, NOW(), NOW()),
('Otros',        'General',   @tid, NOW(), NOW());
```

### Paso 5 — Usuario administrador del tenant

```javascript
// Ejecutar en Node.js con bcrypt:
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash('PasswordTemporal123!', 10);
// INSERT INTO users (username, email, password_hash, role, tenant_id, full_name, is_active, created_at, updated_at)
// VALUES ('admin_acme', 'ti@acme.com', '<hash>', 'administrador', @tid, 'Administrador ACME', 1, NOW(), NOW())
```

### Paso 6 — Verificar aislamiento

```sql
-- Todos los tickets del tenant nuevo deben ser 0:
SELECT COUNT(*) FROM tickets WHERE tenant_id = @tid;

-- El usuario solo pertenece al tenant correcto:
SELECT id, email, role, tenant_id FROM users WHERE tenant_id = @tid;

-- Feature flags activos:
SELECT name, enabled FROM tenant_features WHERE tenant_id = @tid;
```

### Paso 7 — Primer login y cambio de contraseña

```bash
curl -X POST http://tuapp.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin_acme","password":"PasswordTemporal123!"}'
# → accessToken + refreshToken
# Enviar credenciales al cliente y pedirle que cambie la contraseña en el primer login
```

---

## Estado de observabilidad (Fase 7)

| Componente | URL | Estado |
|---|---|---|
| Prometheus scrape | `http://localhost:3000/metrics` | ✅ Activo (276+ líneas) |
| Prometheus UI | `http://localhost:9090` | ✅ Corriendo en Docker |
| Grafana | `http://localhost:3001` | ✅ Corriendo con dashboard pre-cargado |
| Dashboard | ITSM Platform — Overview | ✅ Auto-provisionado |
| Alertas | `observability/alerts.yml` | ✅ SLA breach, 5xx rate, latencia p95, IA lenta |

### Queries Prometheus útiles

```promql
# Requests por minuto
rate(itsm_http_requests_total[1m]) * 60

# Tasa de errores 5xx
rate(itsm_http_errors_total{status_code=~"5.."}[5m]) / rate(itsm_http_requests_total[5m])

# Latencia p95
histogram_quantile(0.95, rate(itsm_http_request_duration_seconds_bucket[5m]))

# Tickets abiertos por tenant
itsm_open_tickets

# SLA breaches última hora
increase(itsm_sla_breaches_total[1h])

# Duración media de llamadas IA
histogram_quantile(0.50, rate(itsm_ai_request_duration_seconds_bucket[5m]))

# Memoria heap Node.js
itsm_nodejs_heap_size_used_bytes / itsm_nodejs_heap_size_total_bytes
```

### Seed de métricas de prueba

```bash
# Genera 5 rondas de tráfico HTTP real contra el servidor
node scripts/utilities/seed-metrics.js 5
```

---

## Respuesta a: ¿está listo para ser SaaS?

### Lo que SÍ funciona multi-tenant hoy

- Cada request resuelve su tenant por host o header → datos completamente aislados
- Roles y permisos se verifican por tenant (Casbin + Policy classes)
- Feature flags y branding configurables por tenant sin reiniciar la app
- Workflows de aprobación configurables por tenant
- IA adaptada al contexto del tenant (nombre, features activas)
- Métricas segregadas por tenant en Prometheus (label `tenant`)

### Lo que NO está listo para producción

1. ~~**Onboarding**: proceso manual~~ → ✅ `provision-tenant.js` (Fase 8)
2. ~~**Suspensión**: no hay mecanismo de baja~~ → ✅ `TenantLifecycleService` (Fase 8)
3. ~~**TLS/Nginx**: app en puerto 3000 sin HTTPS~~ → ✅ `nginx/itsm.conf` (Fase 9)
4. ~~**Secrets**: credenciales en `.env` plano~~ → ✅ `check-env.js` + guía de secret stores (Fase 9)
5. ~~**Bearer JWT**: integraciones externas~~ → ✅ dual auth cookie+Bearer (Fase 9)
6. ~~**Docker inseguro**: imagen con .env, root user, sin healthcheck~~ → ✅ `.dockerignore`, non-root user, `HEALTHCHECK`, entrypoint con migraciones automáticas
7. ~~**MySQL expuesto públicamente**~~ → ✅ `127.0.0.1:3306` + `healthcheck` + `depends_on: condition: service_healthy`
8. **CI/CD**: deploy manual → Fase 10
9. **Límites de plan**: todos los tenants tienen el mismo acceso → Fase 11
10. **Billing**: no hay mecanismo de cobro automatizado → Fase 11

### Veredicto

> **Estructuralmente listo para escalar.** La arquitectura multi-tenant está correctamente implementada.  
> **No listo para producción compartida** sin completar las Fases 8 (lifecycle) y 9 (hardening).  
> Tiempo estimado para producción-ready: **3–5 semanas** con un desarrollador.

---

## Stack técnico actual

```
Node.js 20 + Express 4
Sequelize 6 (MySQL/PostgreSQL/MSSQL)
Socket.io 4
Bull + Redis (queues)
Casbin (RBAC)
EventEmitter2 (event bus)
Groq SDK (IA)
prom-client (métricas)
Winston (logs)
Azure MSAL (auth opcional)
Docker + docker-compose
```

## Archivos clave de referencia

| Archivo | Propósito |
|---|---|
| `src/repositories/TenantBaseRepository.js` | Toda query con `tenant_id` filtrado automáticamente |
| `src/middlewares/tenant/tenantMiddleware.js` | Resolver tenant antes de cada request |
| `src/core/events/EventBus.js` | Bus central de eventos (Promise.allSettled) |
| `src/core/workflow/WorkflowEngine.js` | Motor de aprobaciones multi-step |
| `src/core/ai/GroqProvider.js` | Cliente IA con métricas de duración |
| `src/core/metrics/MetricsRegistry.js` | Todos los contadores/histogramas Prometheus |
| `src/config/rbac/rbac_policy.csv` | Política RBAC completa (roles × recursos × acciones) |
| `src/core/policies/` | ABAC: TicketPolicy, ChangePolicy, AssetPolicy, KnowledgePolicy |
| `observability/` | prometheus.yml, alerts.yml, Grafana dashboard JSON |
| `docker-compose.observability.yml` | Stack Prometheus + Grafana |
| `scripts/utilities/seed-metrics.js` | Generador de tráfico para poblar Grafana |

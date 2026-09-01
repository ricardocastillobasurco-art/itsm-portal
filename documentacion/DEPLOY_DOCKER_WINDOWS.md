# Despliegue ITSM con Docker en Windows
### Guía definitiva para principiantes — todo corre en contenedores
> **Ya tienes:** Docker Desktop instalado y el proyecto en `C:\itsm`  
> **Tiempo estimado:** 30–60 minutos la primera vez

---

## Arquitectura real del sistema

Antes de ejecutar cualquier comando, entiende qué vas a levantar:

```
                   INTERNET / RED LOCAL
                          │
                     puerto 80
                          │
                   ┌──────▼──────┐
                   │    nginx    │  ← único punto de entrada desde fuera
                   │ (proxy inv) │    recibe peticiones y las reenvía a la app
                   └──────┬──────┘
                          │ red interna Docker
                   ┌──────▼──────┐
                   │     app     │  ← Node.js ITSM (puerto 3000 solo interno)
                   │  (Node.js)  │    arranca migraciones, sirve la web
                   └──────┬──────┘
              ┌───────────┴───────────┐
       ┌──────▼──────┐         ┌──────▼──────┐
       │    mysql    │         │    redis    │
       │  (base BD)  │         │   (caché)   │
       └─────────────┘         └─────────────┘
```

**Lo que tienes en el proyecto:**

| Archivo                            | Para qué sirve                                     |
|------------------------------------|----------------------------------------------------|
| `docker-compose.windows.yml`       | **Stack principal** — mysql + redis + app + nginx  |
| `docker-compose.yml`               | Solo desarrollo local (sin nginx, puertos abiertos)|
| `docker-compose.observability.yml` | Opcional — Prometheus + Grafana (métricas)         |

**Para producción en Windows siempre usarás `docker-compose.windows.yml`.**

---

## ANTES DE EMPEZAR — ¿Estás detrás de un proxy corporativo?

Si tu empresa tiene proxy, Docker no puede descargar imágenes sin configurarlo.  
**Síntoma:** error con `proxyconnect` o `i/o timeout` al ejecutar `docker compose up`.

**Cómo configurarlo:**

1. Abre **Docker Desktop** → ícono de engranaje ⚙️ arriba a la derecha
2. Menú izquierdo: **Resources → Proxies**
3. Activa **"Manual proxy configuration"**
4. Escribe la dirección de tu proxy en ambos campos:
   ```
   Web Server (HTTP):          http://10.226.14.60:8080
   Secure Web Server (HTTPS):  http://10.226.14.60:8080
   ```
   *(reemplaza la IP y puerto con los de tu empresa)*
5. Clic en **Apply & Restart** — espera a que Docker reinicie (ícono azul fijo)

Si el proxy pide usuario y contraseña: `http://USUARIO:PASSWORD@10.226.14.60:8080`

**Verificar que el proxy funciona:**
```powershell
docker pull hello-world
# Debe descargar sin error y mostrar "Hello from Docker!"
```

---

## PASO 1 — Verificar que Docker Desktop está listo

```powershell
docker info
```

Si muestra información (versión, sistema operativo, contenedores) → listo.  
Si da error → abre Docker Desktop desde el menú Inicio y espera a que el ícono 🐳 quede **azul fijo** (no animado). Puede tardar 1–2 minutos.

---

## PASO 2 — Crear el archivo de configuración (.env)

El `.env` define todas las contraseñas y parámetros de la app. Es el único archivo que debes editar a mano en cada servidor.

```powershell
cd C:\itsm

# Crear desde la plantilla incluida
Copy-Item .env.example .env

# Abrir en el Bloc de notas
notepad .env
```

**Valores que DEBES cambiar** (el resto puedes dejarlo como está):

```bash
# ── Servidor ──────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production
API_BASE_URL=http://192.168.1.50        # ← IP real de este servidor (sin puerto, nginx escucha en 80)

# ── Base de datos ──────────────────────────────────────────────────────
EQUIPMENT_HOST=mysql                    # ← NO cambies — nombre del contenedor en Docker
EQUIPMENT_USER=itsm_user
EQUIPMENT_PASSWORD=CambiaMePorUnaPasswordSegura123!
EQUIPMENT_DATABASE=equipment_management
EQUIPMENT_PORT=3306

# ── Claves de seguridad ─────────────────────────────────────────────────
JWT_SECRET=GENERAR_ABAJO
JWT_REFRESH_SECRET=GENERAR_ABAJO
JWT_EXPIRE=59m
SESSION_SECRET=GENERAR_ABAJO

# ── Redis (caché de sesiones) ───────────────────────────────────────────
REDIS_HOST=redis                        # ← NO cambies — nombre del contenedor en Docker
REDIS_PORT=6379
REDIS_PASSWORD=                         # puedes dejarlo vacío

# ── CORS ────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS=http://192.168.1.50     # ← misma IP que API_BASE_URL

# ── Observabilidad (opcional) ───────────────────────────────────────────
GRAFANA_ADMIN_PASSWORD=CambiaMePorOtraPasswordSegura!

# ── Email (opcional — para notificaciones de tickets) ───────────────────
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=tu@empresa.com
SMTP_PASS=tu_password_smtp

# ── Jira (opcional — si integras con Jira) ──────────────────────────────
JIRA_HOST=https://tu-empresa.atlassian.net
JIRA_EMAIL=tu@empresa.com
JIRA_API_TOKEN=tu_token_jira
```

Guarda y cierra (`Ctrl+S` → cerrar ventana).

### Generar las claves secretas (JWT y Session)

Estas claves deben ser únicas y aleatorias. Ejecuta este comando **3 veces** en PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

- 1ra salida → pega en `JWT_SECRET`
- 2da salida → pega en `JWT_REFRESH_SECRET`
- 3ra salida → pega en `SESSION_SECRET`

> Si no tienes Node en este servidor, usa este alternativo:
> ```powershell
> [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(64))
> ```

### Verificar el .env antes de continuar

```powershell
cd C:\itsm
node scripts/utilities/check-env.js
```

Debe terminar con: `✅ Todas las variables requeridas están presentes.`  
Si aparece `❌`, corrige ese valor en el `.env` y vuelve a ejecutar.

---

## PASO 3 — Descargar las imágenes Docker

Las imágenes son las "bases" sobre las que corren los contenedores. Descárgalas antes de construir para ver el progreso claramente:

```powershell
# Imagen de MySQL
docker pull mysql:8.0

# Imagen de Redis
docker pull redis:7-alpine

# Imagen de Nginx
docker pull nginx:1.25-alpine

# La imagen de la app (node:20-alpine) se descarga automáticamente al construir
# Pero si quieres tenerla ya:
docker pull node:20-alpine
```

Cada descarga muestra su progreso. La primera vez puede tardar varios minutos según tu conexión.

---

## PASO 4 — Construir la imagen de la aplicación

Este paso compila tu código Node.js dentro de una imagen Docker:

```powershell
cd C:\itsm
docker build -t itsm-app .
```

Verás los pasos del `Dockerfile` ejecutándose:
```
 => [1/6] FROM node:20-alpine
 => [2/6] RUN addgroup -S itsm ...
 => [3/6] COPY package*.json ./
 => [4/6] RUN npm ci --omit=dev
 => [5/6] COPY --chown=itsm:itsm . .
 => [6/6] RUN chmod +x scripts/docker-entrypoint.sh
 => exporting to image
```

Tarda 2–5 minutos la primera vez (instala dependencias npm). Las siguientes veces es mucho más rápido porque Docker guarda las capas en caché.

---

## PASO 5 — Levantar el stack completo

```powershell
cd C:\itsm
docker compose -f docker-compose.windows.yml up -d
```

**¿Qué hace este comando?**
- Levanta los 4 contenedores: `mysql`, `redis`, `app`, `nginx`
- `-d` = en segundo plano (la terminal queda libre)
- `app` espera a que `mysql` y `redis` estén `healthy` antes de arrancar

### Ver qué está pasando en tiempo real

```powershell
docker compose -f docker-compose.windows.yml logs -f
```

Presiona `Ctrl+C` para salir de los logs (los contenedores **siguen corriendo**).

### Señales de que todo salió bien

```
itsm-app  | [entrypoint] Validando variables de entorno...
itsm-app  | ✅ Todas las variables requeridas están presentes.
itsm-app  | [entrypoint] Ejecutando migraciones pendientes...
itsm-app  | == 20240101000001-create-roles: migrated
itsm-app  | ...
itsm-app  | ✅ Servidor corriendo en puerto 3000
```

### Ver el estado de los 4 contenedores

```powershell
docker compose -f docker-compose.windows.yml ps
```

Resultado esperado:
```
NAME           IMAGE               STATUS
itsm-mysql     mysql:8.0           healthy
itsm-redis     redis:7-alpine      healthy
itsm-app       itsm-app            running
itsm-nginx     nginx:1.25-alpine   running
```

---

## PASO 6 — Importar la base de datos

### Si tienes un backup (.sql de la máquina anterior)

```powershell
# 1. Copiar el archivo SQL dentro del contenedor MySQL
docker compose -f docker-compose.windows.yml cp C:\backup_itsm.sql mysql:/backup.sql

# 2. Importar la base de datos
docker compose -f docker-compose.windows.yml exec mysql `
    sh -c 'mysql -u$MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < /backup.sql'
```

Espera a que termine. Puede tardar varios minutos si la base de datos es grande.

### Si es instalación nueva (sin backup)

Las migraciones del Paso 5 ya crearon todas las tablas automáticamente. Omite este paso.

---

## PASO 7 — Abrir el puerto en el Firewall de Windows

La aplicación es accesible por el **puerto 80** (nginx lo recibe y lo reenvía a la app internamente).

```powershell
# Crear regla en el Firewall (ejecutar como Administrador)
New-NetFirewallRule -DisplayName "ITSM HTTP" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 80 `
    -Action Allow

# Verificar
Get-NetFirewallRule -DisplayName "ITSM HTTP" | Select-Object DisplayName, Enabled, Action
```

---

## PASO 8 — Verificar que todo funciona

```powershell
# Probar desde el mismo servidor
Invoke-WebRequest http://localhost -UseBasicParsing | Select-Object StatusCode
# Esperado: StatusCode 200

# Health check de la app
Invoke-WebRequest http://localhost/health -UseBasicParsing | Select-Object -ExpandProperty Content
# Esperado: {"db":"ok","redis":"ok","alive":true}
```

Desde otro equipo en la red, abre el navegador:
```
http://192.168.1.50
```
*(reemplaza con la IP real del servidor — sin puerto, nginx usa el 80 estándar)*

Debes ver la pantalla de login de ITSM.

---

## PASO 9 — Observabilidad: Prometheus + Grafana (opcional)

Este stack es **independiente** del principal. Solo levántalo si necesitas ver métricas y gráficos del sistema.

```powershell
cd C:\itsm
docker compose -f docker-compose.observability.yml up -d
```

Una vez levantado:

| Herramienta | URL                        | Usuario  | Password                       |
|-------------|----------------------------|----------|--------------------------------|
| Grafana     | `http://IP-SERVIDOR:3001`  | `admin`  | valor de `GRAFANA_ADMIN_PASSWORD` en .env |
| Prometheus  | `http://IP-SERVIDOR:9090`  | —        | sin autenticación              |

> Grafana ya viene configurado con un dashboard de ITSM preconstruido.  
> Prometheus ya está configurado para scrapearte la app en `/metrics`.

Para apagarlo cuando no lo necesites:
```powershell
docker compose -f docker-compose.observability.yml down
```

---

## PASO 10 — Arranque automático con Windows

### Docker Desktop

1. Abre Docker Desktop → ⚙️ Settings
2. Activa:
   - ✅ **Start Docker Desktop when you log in**
   - ✅ **Start Docker Desktop in background**
3. Clic en **Apply & Restart**

### Los contenedores se reinician solos

El `docker-compose.windows.yml` tiene `restart: unless-stopped` en todos los servicios:
- Si un contenedor falla → Docker lo reinicia automáticamente
- Si reinicias el servidor → Docker Desktop arranca → los contenedores arrancan

No necesitas configurar nada más.

---

## Operaciones del día a día

Todos los comandos desde `C:\itsm` en **PowerShell como Administrador**.

### Ver estado

```powershell
docker compose -f docker-compose.windows.yml ps
```

### Ver logs

```powershell
# Todos los servicios en tiempo real
docker compose -f docker-compose.windows.yml logs -f

# Solo la app Node.js
docker compose -f docker-compose.windows.yml logs -f app

# Últimas 50 líneas sin quedarse enganchado
docker compose -f docker-compose.windows.yml logs app --tail 50
```

### Reiniciar

```powershell
# Solo la app (sin tocar MySQL ni Redis — datos intactos)
docker compose -f docker-compose.windows.yml restart app

# Todo el stack
docker compose -f docker-compose.windows.yml restart
```

### Apagar y encender

```powershell
# Apagar (los datos en volúmenes se conservan)
docker compose -f docker-compose.windows.yml down

# Encender de nuevo
docker compose -f docker-compose.windows.yml up -d
```

### Actualizar el código de la app

```powershell
# 1. Copiar los nuevos archivos a C:\itsm\ (sobreescribiendo los anteriores)

# 2. Reconstruir la imagen y reiniciar solo la app
cd C:\itsm
docker compose -f docker-compose.windows.yml up -d --build app

# Las nuevas migraciones se ejecutan automáticamente al arrancar
```

### Entrar a MySQL

```powershell
docker compose -f docker-compose.windows.yml exec mysql mysql -u itsm_user -p
# Ingresa la contraseña de EQUIPMENT_PASSWORD

# Dentro del prompt MySQL:
USE equipment_management;
SHOW TABLES;
exit
```

### Backup manual de la base de datos

```powershell
New-Item -ItemType Directory -Path C:\backups -Force

$fecha = Get-Date -Format "yyyyMMdd_HHmmss"
docker compose -f docker-compose.windows.yml exec mysql `
    mysqldump -u itsm_user -pTU_PASSWORD_AQUI equipment_management |
    Out-File -Encoding utf8 "C:\backups\itsm_$fecha.sql"

Write-Host "Backup guardado: C:\backups\itsm_$fecha.sql"
```

*(reemplaza `TU_PASSWORD_AQUI` con el valor de `EQUIPMENT_PASSWORD` en tu `.env`)*

---

## Resolución de problemas

### Docker Desktop no arranca / "unable to start"

Abre Docker Desktop desde el menú Inicio. Espera el ícono 🐳 azul fijo en la bandeja.  
Si sigue fallando, reinicia el servidor.

### Error `proxyconnect tcp: i/o timeout` al descargar imágenes

Proxy corporativo sin configurar. Lee la sección **"ANTES DE EMPEZAR"** al inicio de esta guía.

### Los contenedores arrancan pero la app da error de base de datos

```powershell
# Ver si MySQL está healthy
docker compose -f docker-compose.windows.yml ps

# Si mysql dice "starting", espera 30 segundos y vuelve a verificar
# Ver logs de MySQL
docker compose -f docker-compose.windows.yml logs mysql --tail 20
```

Si MySQL aparece `unhealthy` y las credenciales en `.env` son correctas, prueba borrar el volumen (solo en instalación nueva, esto borra los datos):
```powershell
docker compose -f docker-compose.windows.yml down
docker volume rm itsm_mysql_data
docker compose -f docker-compose.windows.yml up -d
```

### La página no carga desde otro equipo

```powershell
# 1. Verificar que nginx está corriendo
docker compose -f docker-compose.windows.yml ps

# 2. Probar localmente
Invoke-WebRequest http://localhost -UseBasicParsing

# 3. Verificar regla de Firewall para puerto 80
Get-NetFirewallRule -DisplayName "ITSM*"
# Si no aparece, crearla:
New-NetFirewallRule -DisplayName "ITSM HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

### Ver qué hay dentro de un contenedor

```powershell
# Terminal dentro de la app
docker compose -f docker-compose.windows.yml exec app sh
ls /app
cat /app/.env
exit

# Terminal dentro de MySQL
docker compose -f docker-compose.windows.yml exec mysql sh
mysql -u itsm_user -p
exit
```

### Liberar espacio en disco

```powershell
docker system df                # ver uso actual
docker image prune -f           # borrar imágenes antiguas sin borrar datos
```

---

## Checklist final

```
IMÁGENES DESCARGADAS
[ ] docker images  →  aparecen: mysql:8.0, redis:7-alpine, nginx:1.25-alpine, itsm-app

CONTENEDORES
[ ] docker compose -f docker-compose.windows.yml ps
    →  4 contenedores: itsm-mysql (healthy), itsm-redis (healthy), itsm-app (running), itsm-nginx (running)

APLICACIÓN
[ ] http://IP-SERVIDOR  →  muestra pantalla de login (sin puerto — nginx usa el 80)
[ ] http://localhost/health  →  {"db":"ok","redis":"ok","alive":true}
[ ] docker compose -f docker-compose.windows.yml logs app --tail 30  →  sin errores rojos

BASE DE DATOS
[ ] Datos visibles al iniciar sesión (o migraciones ejecutadas si es instalación nueva)
[ ] Backup de prueba generado en C:\backups\

SEGURIDAD
[ ] JWT_SECRET, JWT_REFRESH_SECRET, SESSION_SECRET son valores únicos generados (no los de ejemplo)
[ ] EQUIPMENT_PASSWORD es una contraseña real (no el texto de ejemplo)
[ ] Puerto 80 abierto en Firewall de Windows
[ ] Puertos 3000, 3306, 6379 NO accesibles desde fuera (nginx es el único punto de entrada)
[ ] .env está en C:\itsm\ y NO está en git

ARRANQUE AUTOMÁTICO
[ ] Docker Desktop configurado para iniciar con Windows
[ ] Reiniciar el servidor → esperar 2 min → http://IP-SERVIDOR vuelve a funcionar
```

---

## Resumen de comandos esenciales

| ¿Qué necesitas?              | Comando (desde `C:\itsm`)                                                    |
|------------------------------|------------------------------------------------------------------------------|
| Encender todo                | `docker compose -f docker-compose.windows.yml up -d`                         |
| Apagar todo                  | `docker compose -f docker-compose.windows.yml down`                          |
| Ver estado                   | `docker compose -f docker-compose.windows.yml ps`                            |
| Ver logs en tiempo real      | `docker compose -f docker-compose.windows.yml logs -f app`                   |
| Reiniciar solo la app        | `docker compose -f docker-compose.windows.yml restart app`                   |
| Actualizar código            | `docker compose -f docker-compose.windows.yml up -d --build app`             |
| Entrar a MySQL               | `docker compose -f docker-compose.windows.yml exec mysql mysql -u itsm_user -p` |
| Ver últimas 50 líneas de log | `docker compose -f docker-compose.windows.yml logs app --tail 50`            |
| Levantar Grafana+Prometheus  | `docker compose -f docker-compose.observability.yml up -d`                   |

> Todos los comandos en **PowerShell como Administrador** desde `C:\itsm`

---

*Generado: Mayo 2026 — ITSM Multi-Tenant v1.0*

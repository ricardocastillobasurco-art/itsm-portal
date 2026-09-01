# Guía de Despliegue — Servidor Local (On-Premise)
> **Para:** Técnico o administrador que recibe el servidor  
> **Desde:** Máquina de desarrollo Windows con el proyecto listo  
> **Destino:** Servidor Linux (Ubuntu 22.04 LTS) **o** Windows Server 2019/2022

---

## ¿Qué sistema operativo tiene el servidor?

| | Linux (Ubuntu) | Windows Server |
|---|---|---|
| **Recomendado para producción** | ✅ Sí | ⚠️ Funciona, más configuración |
| **Docker disponible** | ✅ Nativo | ✅ Docker Desktop |
| **Redis nativo** | ✅ Sí | ❌ Necesita Docker o WSL2 |
| **Nginx nativo** | ✅ Sí | ⚠️ Versión Windows o IIS |
| **Gestión de procesos** | PM2 + systemd | PM2 + NSSM (servicio Windows) |

Elige tu ruta:
- **[PARTE I — Linux (Ubuntu)](#parte-i--linux-ubuntu-2204-lts)** ← recomendada
- **[PARTE II — Windows Server](#parte-ii--windows-server-20192022)**

---

# PARTE I — Linux (Ubuntu 22.04 LTS)

## Índice
1. [Requisitos del servidor](#1-requisitos-del-servidor)
2. [Preparar el proyecto en tu máquina](#2-preparar-el-proyecto-en-tu-máquina)
3. [Transferir el proyecto al servidor](#3-transferir-el-proyecto-al-servidor)
4. [Instalar software en el servidor](#4-instalar-software-en-el-servidor)
5. [Configurar la base de datos](#5-configurar-la-base-de-datos)
6. [Configurar variables de entorno](#6-configurar-variables-de-entorno)
7. [Instalar dependencias y migrar BD](#7-instalar-dependencias-y-migrar-bd)
8. [Levantar con Docker (opción A — recomendada)](#8-opción-a--docker-recomendado)
9. [Levantar sin Docker (opción B — Node directo)](#9-opción-b--node-directo)
10. [Configurar Nginx como proxy](#10-configurar-nginx-como-proxy)
11. [Verificar que todo funciona](#11-verificar-que-todo-funciona)
12. [Arranque automático y logs](#12-arranque-automático-y-logs)
13. [Checklist final Linux](#13-checklist-final)

---

## 1. Requisitos del servidor

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disco | 20 GB | 50 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Puertos abiertos | 22 (SSH), 80, 443 | 22, 80, 443 |
| Acceso a internet | Sí (para instalar paquetes) | Sí |

> **Nota:** Los puertos 3000, 3306, 6379 deben estar **cerrados al exterior** — solo accesibles desde el mismo servidor. Nginx los proxea internamente.

---

## 2. Preparar el proyecto en tu máquina

Desde tu máquina Windows, en la carpeta del proyecto:

### 2.1 Exportar la base de datos local

Abre PowerShell o CMD:

```powershell
# Reemplaza <usuario> y <nombre_bd> con tus valores locales
mysqldump -u<usuario> -p <nombre_bd> > backup_local.sql
```

Guarda el archivo `backup_local.sql` — lo necesitarás en el paso 5.

### 2.2 Verificar que .gitignore está correcto

Asegúrate de que el proyecto **no incluye** estos archivos antes de transferir:
- `.env` (tiene tus contraseñas locales)
- `node_modules/` (se reinstalan en el servidor)
- `uploads/` (si contiene archivos de usuarios)

### 2.3 Comprimir el proyecto

```powershell
# En PowerShell, desde la carpeta PADRE del proyecto
Compress-Archive -Path "project-root - copia" -DestinationPath "itsm-app.zip" -Force
```

---

## 3. Transferir el proyecto al servidor

Necesitas el **IP del servidor** y acceso SSH. El administrador del servidor te dará:
- IP del servidor (ejemplo: `192.168.1.100`)
- Usuario SSH (ejemplo: `ubuntu` o `admin`)
- Contraseña o archivo de clave `.pem`

### 3.1 Subir el proyecto

Desde PowerShell en tu máquina:

```powershell
# Con contraseña:
scp itsm-app.zip ubuntu@192.168.1.100:/home/ubuntu/

# Con clave .pem:
scp -i "C:\ruta\a\mi-clave.pem" itsm-app.zip ubuntu@192.168.1.100:/home/ubuntu/

# También subir el backup de la BD:
scp backup_local.sql ubuntu@192.168.1.100:/home/ubuntu/
```

### 3.2 Conectarte al servidor

```powershell
# Con contraseña:
ssh ubuntu@192.168.1.100

# Con clave .pem:
ssh -i "C:\ruta\a\mi-clave.pem" ubuntu@192.168.1.100
```

A partir de aquí **todos los comandos se ejecutan en el servidor**.

### 3.3 Descomprimir el proyecto

```bash
cd /home/ubuntu
unzip itsm-app.zip -d itsm
mv "itsm/project-root - copia" /srv/itsm
```

---

## 4. Instalar software en el servidor

### 4.1 Actualizar el sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### 4.2 Instalar Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # debe mostrar v20.x.x
npm --version
```

### 4.3 Instalar MySQL 8

```bash
sudo apt install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql

# Asegurar instalación (crear contraseña root, deshabilitar acceso remoto)
sudo mysql_secure_installation
```

### 4.4 Instalar Redis

```bash
sudo apt install -y redis-server
sudo systemctl start redis
sudo systemctl enable redis

# Verificar que funciona:
redis-cli ping   # debe responder: PONG
```

### 4.5 Instalar Nginx

```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 4.6 (Opcional) Instalar Docker si usarás la opción A

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
```

---

## 5. Configurar la base de datos

### 5.1 Crear usuario y base de datos

```bash
sudo mysql -u root -p
```

Dentro de MySQL:

```sql
CREATE DATABASE equipment_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'itsm_user'@'localhost' IDENTIFIED BY 'UnaPasswordSegura123!';
GRANT ALL PRIVILEGES ON equipment_management.* TO 'itsm_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> Guarda el usuario (`itsm_user`) y la contraseña — los usarás en el `.env`.

### 5.2 Importar el backup de desarrollo

```bash
mysql -u itsm_user -p equipment_management < /home/ubuntu/backup_local.sql
```

> Si el servidor arranca con BD vacía (sin importar backup), el entrypoint correrá las 26 migraciones automáticamente y creará todas las tablas.

---

## 6. Configurar variables de entorno

```bash
cd /srv/itsm
cp .env.example .env
nano .env
```

Edita estos valores con los datos reales del servidor:

```bash
# ── Servidor ──────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production
API_BASE_URL=http://IP_DEL_SERVIDOR   # o tu dominio: https://itsm.tuempresa.com

# ── Base de datos ─────────────────────────────────────────────────
EQUIPMENT_HOST=localhost
EQUIPMENT_USER=itsm_user
EQUIPMENT_PASSWORD=UnaPasswordSegura123!
EQUIPMENT_DATABASE=equipment_management
EQUIPMENT_PORT=3306

# ── JWT (CAMBIA ESTOS VALORES — mínimo 32 caracteres aleatorios) ──
JWT_SECRET=genera-una-cadena-aleatoria-de-64-chars-aqui
JWT_REFRESH_SECRET=otra-cadena-aleatoria-diferente-de-64-chars
JWT_EXPIRE=59m

# ── Sesión ────────────────────────────────────────────────────────
SESSION_SECRET=otra-cadena-aleatoria-para-sesiones

# ── Redis ─────────────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=       # dejar vacío si no pusiste contraseña a Redis

# ── CORS ──────────────────────────────────────────────────────────
ALLOWED_ORIGINS=http://IP_DEL_SERVIDOR,https://itsm.tuempresa.com

# ── IA Groq (opcional) ────────────────────────────────────────────
GROQ_API_KEY=gsk_...

# ── Email SMTP ────────────────────────────────────────────────────
SMTP_HOST=smtp.tuproveedor.com
SMTP_PORT=587
SMTP_USER=correo@tuempresa.com
SMTP_PASS=contraseña_email
MAIL_FROM_NAME=correo@tuempresa.com
```

### Generar secrets seguros

```bash
# Ejecuta esto 3 veces (una por cada secret) y pega los resultados en el .env
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Verificar que el .env está correcto

```bash
node scripts/utilities/check-env.js
```

Debe mostrar `✅ Todas las variables requeridas están presentes.`

---

## 7. Instalar dependencias y migrar BD

```bash
cd /srv/itsm

# Instalar dependencias de producción (sin devDependencies)
npm ci --omit=dev

# Ejecutar las 26 migraciones (crea todas las tablas si partiste de BD vacía)
npm run migrate
```

Deberías ver algo como:
```
== 20240101000001-create-roles: migrating =======
== 20240101000001-create-roles: migrated (0.123s)
...
== 20260511000026-ticket-categories-tenant-id: migrated (0.045s)
```

---

## 8. Opción A — Docker (recomendado)

Si instalaste Docker en el paso 4.6, esta es la forma más simple:

```bash
cd /srv/itsm

# Construir imagen y levantar todo (MySQL + Redis + App)
docker compose up -d --build

# Ver que los 3 contenedores estén running:
docker compose ps

# Ver logs en tiempo real:
docker compose logs -f app
```

El entrypoint automáticamente:
1. Valida las variables de entorno
2. Corre las migraciones pendientes
3. Arranca el servidor

> **Con Docker, MySQL y Redis son los del contenedor.** No necesitas los del paso 4 y 5. Puedes omitirlos si vas directo a Docker.

### Verificar que arrancó:

```bash
curl http://localhost:3000/health
# Respuesta esperada: {"db":"ok","redis":"ok","uptime":...}
```

---

## 9. Opción B — Node directo

Si no usas Docker, arranca la app directamente con PM2 (gestor de procesos):

### 9.1 Instalar PM2

```bash
sudo npm install -g pm2
```

### 9.2 Crear archivo de configuración PM2

```bash
cat > /srv/itsm/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name:        'itsm-app',
    script:      'server.js',
    cwd:         '/srv/itsm',
    instances:   1,
    exec_mode:   'fork',
    env: {
      NODE_ENV: 'production',
      PORT:     3000,
    },
    error_file:  '/var/log/itsm/error.log',
    out_file:    '/var/log/itsm/out.log',
    merge_logs:  true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
EOF

sudo mkdir -p /var/log/itsm
sudo chown $USER:$USER /var/log/itsm
```

### 9.3 Arrancar con PM2

```bash
cd /srv/itsm

# Validar entorno y migrar antes de arrancar
node scripts/utilities/check-env.js
npm run migrate

# Iniciar con PM2
pm2 start ecosystem.config.js

# Ver estado:
pm2 status

# Ver logs:
pm2 logs itsm-app
```

### 9.4 Guardar configuración para sobrevivir reinicios

```bash
pm2 save
pm2 startup systemd
# PM2 mostrará un comando con sudo — cópialo y ejecútalo
```

---

## 10. Configurar Nginx como proxy

El archivo de configuración ya está generado en el proyecto:

```bash
# Copiar la plantilla al directorio de Nginx
sudo cp /srv/itsm/nginx/itsm.conf /etc/nginx/sites-available/itsm

# Editar: reemplazar APP_DOMAIN con tu IP o dominio real
sudo nano /etc/nginx/sites-available/itsm
```

### Si solo tienes IP (sin dominio, sin TLS)

Reemplaza todo el contenido con esta versión simplificada:

```nginx
server {
    listen 80;
    server_name _;   # acepta cualquier petición

    client_max_body_size 25M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
    }
}
```

### Si tienes dominio (con TLS — recomendado)

```bash
# Instalar Certbot para obtener certificado SSL gratuito
sudo apt install -y certbot python3-certbot-nginx

# Obtener certificado (reemplaza con tu dominio real)
sudo certbot --nginx -d itsm.tuempresa.com

# Certbot modifica Nginx automáticamente con TLS
```

### Activar el sitio

```bash
sudo ln -s /etc/nginx/sites-available/itsm /etc/nginx/sites-enabled/itsm
sudo rm -f /etc/nginx/sites-enabled/default   # quitar página por defecto de Nginx

# Verificar configuración:
sudo nginx -t

# Recargar Nginx:
sudo systemctl reload nginx
```

---

## 11. Verificar que todo funciona

Ejecuta estas verificaciones desde el servidor:

```bash
# 1. Health check de la app
curl http://localhost:3000/health
# Esperado: {"db":"ok","redis":"ok","alive":true}

# 2. Liveness probe (Kubernetes-ready)
curl http://localhost:3000/health/live
# Esperado: {"alive":true}

# 3. Readiness probe (BD accesible)
curl http://localhost:3000/health/ready
# Esperado: {"ready":true}

# 4. Que Nginx proxea correctamente
curl http://localhost/health
# Mismo resultado que el anterior pero por el puerto 80
```

Desde **tu máquina** (fuera del servidor):

```bash
# Reemplaza con la IP real del servidor
curl http://192.168.1.100/health
```

### Verificar la BD

```bash
mysql -u itsm_user -p equipment_management -e "SHOW TABLES;"
# Debe listar las ~25 tablas del sistema (tenants, tickets, users, etc.)
```

### Verificar Redis

```bash
redis-cli ping
# Respuesta: PONG
```

---

## 12. Arranque automático y logs

### Con Docker

```bash
# Los contenedores tienen restart: unless-stopped
# Se reinician solos si el servidor se reinicia

# Ver logs:
docker compose logs -f app

# Reiniciar solo la app (sin tocar MySQL/Redis):
docker compose restart app
```

### Con PM2

```bash
# Ver estado de todos los procesos:
pm2 status

# Ver logs en tiempo real:
pm2 logs itsm-app --lines 100

# Reiniciar:
pm2 restart itsm-app

# Si actualizas el código:
cd /srv/itsm
git pull   # o re-transferir archivos
npm ci --omit=dev
npm run migrate
pm2 restart itsm-app
```

### Configurar backup diario

```bash
# Dar permisos de ejecución al script
chmod +x /srv/itsm/scripts/utilities/backup.sh

# Editar crontab
crontab -e
```

Agregar esta línea:
```
0 3 * * * EQUIPMENT_USER=itsm_user EQUIPMENT_PASSWORD=TuPassword EQUIPMENT_DATABASE=equipment_management /srv/itsm/scripts/utilities/backup.sh >> /var/log/itsm-backup.log 2>&1
```

---

## 13. Checklist final

Antes de dar el servidor como listo, confirma cada punto:

```
INFRAESTRUCTURA
[ ] El servidor responde por SSH
[ ] Puertos 80/443 abiertos al exterior, 3306/6379 cerrados al exterior
[ ] Nginx instalado y activo (systemctl status nginx)
[ ] MySQL instalado y activo (systemctl status mysql)
[ ] Redis instalado y activo (systemctl status redis)

APLICACIÓN
[ ] Proyecto en /srv/itsm
[ ] .env configurado con valores reales (no los del ejemplo)
[ ] node scripts/utilities/check-env.js → sin errores
[ ] npm run migrate → 26 migraciones ejecutadas
[ ] curl http://localhost:3000/health → {"db":"ok","redis":"ok"}
[ ] curl http://localhost/health → mismo resultado por Nginx

BASE DE DATOS
[ ] BD importada o migraciones corridas (SHOW TABLES muestra ~25 tablas)
[ ] Usuario itsm_user solo tiene acceso desde localhost
[ ] Backup manual funcionando: bash /srv/itsm/scripts/utilities/backup.sh

PROCESO
[ ] App se reinicia sola si el servidor rebota (PM2 startup o Docker restart: unless-stopped)
[ ] Logs accesibles: pm2 logs o docker compose logs

SEGURIDAD
[ ] JWT_SECRET, JWT_REFRESH_SECRET, SESSION_SECRET cambiados (mínimo 32 chars aleatorios)
[ ] .env NO está en git (git status no lo muestra)
[ ] uploads/ tiene permisos correctos (chown itsm:itsm o el usuario que corre el proceso)
```

---

## Resumen de comandos clave para el día a día

| Acción | Docker | PM2 |
|---|---|---|
| Ver estado | `docker compose ps` | `pm2 status` |
| Ver logs | `docker compose logs -f app` | `pm2 logs itsm-app` |
| Reiniciar app | `docker compose restart app` | `pm2 restart itsm-app` |
| Apagar todo | `docker compose down` | `pm2 stop itsm-app` |
| Actualizar código | `docker compose up -d --build` | `git pull && npm ci && pm2 restart itsm-app` |
| Correr migraciones | Automático al reiniciar | `npm run migrate` |
| Ver BD | `docker compose exec mysql mysql -u root -p` | `mysql -u itsm_user -p` |

---

---

---

# PARTE II — Windows Server 2019/2022

> Todos los comandos de esta sección se ejecutan en **PowerShell como Administrador** dentro del servidor Windows, salvo que se indique lo contrario.

## Índice Windows
- [W1. Requisitos del servidor Windows](#w1-requisitos-del-servidor-windows)
- [W2. Transferir el proyecto al servidor](#w2-transferir-el-proyecto-al-servidor-windows)
- [W3. Instalar software en Windows Server](#w3-instalar-software-en-windows-server)
- [W4. Configurar la base de datos](#w4-configurar-la-base-de-datos-windows)
- [W5. Configurar variables de entorno](#w5-configurar-variables-de-entorno-windows)
- [W6. Instalar dependencias y migrar BD](#w6-instalar-dependencias-y-migrar-bd-windows)
- [W7. Levantar con Docker Desktop (opción A — recomendada)](#w7-opción-a--docker-desktop-recomendado)
- [W8. Levantar sin Docker — Node como servicio Windows (opción B)](#w8-opción-b--node-como-servicio-windows)
- [W9. Configurar proxy inverso](#w9-configurar-proxy-inverso-en-windows)
- [W10. Verificar que todo funciona](#w10-verificar-que-todo-funciona-windows)
- [W11. Arranque automático y logs](#w11-arranque-automático-y-logs-windows)
- [W12. Checklist final Windows](#w12-checklist-final-windows)

---

## W1. Requisitos del servidor Windows

| Recurso | Mínimo | Recomendado |
|---|---|---|
| OS | Windows Server 2019 | Windows Server 2022 |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB (Windows consume más que Linux) |
| Disco | 40 GB | 80 GB |
| Puertos abiertos (Firewall) | 80, 443, 3389 (RDP) | 80, 443, 3389 |
| PowerShell | 5.1 (incluido) | 7.x recomendado |

> Los puertos **3000, 3306, 6379 deben estar bloqueados en el firewall** para acceso externo — solo accesibles localmente. El proxy (IIS o nginx) expone el 80/443.

---

## W2. Transferir el proyecto al servidor Windows

### Opción A — RDP (Escritorio Remoto) con portapapeles compartido

1. Desde tu máquina, comprime el proyecto en un ZIP (igual que el paso 2.3 de Linux).
2. Abre **Conexión a Escritorio Remoto** (`mstsc`) y conecta al servidor.
3. En la pestaña **Recursos locales → Más → Unidades**, activa tu disco local (C:).
4. Dentro del RDP, copia el ZIP desde `\\tsclient\C\ruta\itsm-app.zip` a `C:\itsm-app.zip`.

### Opción B — Carpeta compartida de red

```powershell
# En tu máquina local — copiar al servidor por red (reemplaza IP y credenciales)
$cred = Get-Credential   # pide usuario y contraseña del servidor
Copy-Item "itsm-app.zip" "\\192.168.1.100\C$\itsm-app.zip" -Credential $cred
Copy-Item "backup_local.sql" "\\192.168.1.100\C$\backup_local.sql" -Credential $cred
```

### Opción C — WinSCP (si el servidor tiene SSH/SFTP habilitado)

Descarga [WinSCP](https://winscp.net), conéctate con SFTP al servidor y arrastra los archivos.

### Descomprimir en el servidor

```powershell
# Ejecutar en el servidor (PowerShell como Admin)
Expand-Archive -Path "C:\itsm-app.zip" -DestinationPath "C:\itsm" -Force

# Verificar que la carpeta quedó bien
Get-ChildItem "C:\itsm"   # debes ver server.js, package.json, etc.
```

---

## W3. Instalar software en Windows Server

Abre **PowerShell como Administrador** en el servidor.

### W3.1 Instalar Chocolatey (gestor de paquetes para Windows)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Verificar:
choco --version
```

### W3.2 Instalar Node.js 20

```powershell
choco install nodejs-lts -y
# Cerrar y reabrir PowerShell para que el PATH se actualice

node --version   # debe mostrar v20.x.x
npm --version
```

> Alternativa sin Chocolatey: descarga el instalador `.msi` desde [nodejs.org](https://nodejs.org) y ejecútalo.

### W3.3 Instalar MySQL 8

```powershell
choco install mysql -y
```

Después de instalar, inicia el servicio:

```powershell
Start-Service MySQL
Set-Service MySQL -StartupType Automatic

# Verificar que MySQL corre:
Get-Service MySQL
```

Si Chocolatey no funciona, descarga **MySQL Installer for Windows** desde el sitio oficial y elige la instalación "Server only".

### W3.4 Redis en Windows

Redis no tiene versión oficial para Windows. Usa una de estas opciones:

**Opción recomendada — Docker Desktop (también corre Redis):**
→ Ver sección W7. Docker Desktop incluye Redis como contenedor.

**Opción alternativa — Memurai (compatible con Redis, gratuito para desarrollo):**

```powershell
choco install memurai-developer -y
# Memurai se instala como servicio Windows automáticamente
# Verificar:
memurai-cli ping   # debe responder: PONG
```

**Opción alternativa — WSL2 + Redis:**

```powershell
# Habilitar WSL2
wsl --install -d Ubuntu

# Dentro de WSL2:
# sudo apt update && sudo apt install redis-server -y
# sudo service redis-server start
```

### W3.5 Instalar nginx para Windows

```powershell
choco install nginx -y
# nginx se instala en C:\tools\nginx\

# Iniciar:
Start-Process "C:\tools\nginx\nginx.exe"

# Verificar (debe responder con la página por defecto de nginx):
Invoke-WebRequest http://localhost -UseBasicParsing
```

### W3.6 (Opcional) Docker Desktop — opción A

```powershell
choco install docker-desktop -y
```

Después de instalar: abre Docker Desktop, acepta los términos y espera a que el motor arranque (ícono en la bandeja del sistema).

Verifica:
```powershell
docker --version
docker compose version
```

---

## W4. Configurar la base de datos Windows

### W4.1 Crear usuario y base de datos

```powershell
# Conectar a MySQL como root (te pedirá contraseña)
mysql -u root -p
```

Dentro del prompt de MySQL:

```sql
CREATE DATABASE equipment_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'itsm_user'@'localhost' IDENTIFIED BY 'UnaPasswordSegura123!';
GRANT ALL PRIVILEGES ON equipment_management.* TO 'itsm_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### W4.2 Importar backup de desarrollo

```powershell
mysql -u itsm_user -p equipment_management < C:\backup_local.sql
```

> Si no importas backup, las 26 migraciones crean todas las tablas automáticamente al arrancar la app.

---

## W5. Configurar variables de entorno Windows

```powershell
cd C:\itsm

# Copiar plantilla
Copy-Item .env.example .env

# Editar con Notepad
notepad .env
```

Valores a cambiar en el `.env` para Windows Server:

```bash
PORT=3000
NODE_ENV=production
API_BASE_URL=http://IP_DEL_SERVIDOR

# Base de datos
EQUIPMENT_HOST=localhost
EQUIPMENT_USER=itsm_user
EQUIPMENT_PASSWORD=UnaPasswordSegura123!
EQUIPMENT_DATABASE=equipment_management
EQUIPMENT_PORT=3306

# JWT — genera valores aleatorios con el comando de abajo
JWT_SECRET=CAMBIAR_POR_VALOR_ALEATORIO_64_CHARS
JWT_REFRESH_SECRET=CAMBIAR_POR_OTRO_VALOR_ALEATORIO_64_CHARS
JWT_EXPIRE=59m
SESSION_SECRET=CAMBIAR_POR_OTRO_VALOR_ALEATORIO

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# CORS
ALLOWED_ORIGINS=http://IP_DEL_SERVIDOR
```

### Generar secrets seguros en PowerShell

```powershell
# Ejecuta 3 veces — una por cada secret (JWT_SECRET, JWT_REFRESH_SECRET, SESSION_SECRET)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copia cada resultado y pégalo en el `.env`.

### Verificar el entorno

```powershell
node scripts/utilities/check-env.js
# Debe terminar con: ✅ Todas las variables requeridas están presentes.
```

---

## W6. Instalar dependencias y migrar BD Windows

```powershell
cd C:\itsm

# Instalar dependencias de producción
npm ci --omit=dev

# Correr las 26 migraciones
npm run migrate
```

Deberías ver cada migración listada. Si alguna falla por error de conexión, verifica que MySQL esté corriendo:

```powershell
Get-Service MySQL
# Si está detenido:
Start-Service MySQL
```

---

## W7. Opción A — Docker Desktop (recomendado)

Con Docker Desktop instalado (W3.6), la app, MySQL y Redis corren en contenedores:

```powershell
cd C:\itsm

# Construir imagen y levantar todo
docker compose up -d --build

# Ver estado de los 3 contenedores:
docker compose ps

# Ver logs:
docker compose logs -f app
```

El entrypoint automáticamente valida el entorno, corre migraciones y arranca el servidor.

> **Con Docker no necesitas instalar MySQL ni Redis en Windows** — los pasos W3.3 y W3.4 son opcionales. Docker los crea como contenedores aislados.

### Verificar:

```powershell
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing
# Esperado: {"db":"ok","redis":"ok"}
```

### Hacer que Docker arranque con Windows

En Docker Desktop: **Settings → General → Start Docker Desktop when you log in** ✅

Los contenedores con `restart: unless-stopped` arrancan solos cuando Docker Desktop inicia.

---

## W8. Opción B — Node como servicio Windows

Si no usas Docker, usa PM2 con NSSM para registrar la app como servicio de Windows.

### W8.1 Instalar PM2

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
```

### W8.2 Crear archivo de configuración PM2

```powershell
# Crear el archivo ecosystem
@"
module.exports = {
  apps: [{
    name:        'itsm-app',
    script:      'server.js',
    cwd:         'C:/itsm',
    instances:   1,
    exec_mode:   'fork',
    env: {
      NODE_ENV: 'production',
      PORT:     3000,
    },
    error_file:  'C:/itsm/logs/error.log',
    out_file:    'C:/itsm/logs/out.log',
    merge_logs:  true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
"@ | Out-File -Encoding utf8 C:\itsm\ecosystem.config.js

# Crear carpeta de logs
New-Item -ItemType Directory -Path C:\itsm\logs -Force
```

### W8.3 Arrancar con PM2

```powershell
cd C:\itsm

# Validar entorno y migrar primero
node scripts/utilities/check-env.js
npm run migrate

# Iniciar con PM2
pm2 start ecosystem.config.js

# Ver estado:
pm2 list

# Ver logs:
pm2 logs itsm-app
```

### W8.4 Registrar PM2 como servicio de Windows (arranque automático)

```powershell
# Guarda la lista de procesos
pm2 save

# Instala el startup de Windows
pm2-startup install

# Verifica que el servicio existe:
Get-Service PM2
```

> Si `pm2-startup` no funciona, usa **NSSM** como alternativa:

```powershell
choco install nssm -y

# Registrar la app como servicio Windows con NSSM
nssm install ITSM-App "C:\Program Files\nodejs\node.exe" "C:\itsm\server.js"
nssm set ITSM-App AppDirectory "C:\itsm"
nssm set ITSM-App AppEnvironmentExtra "NODE_ENV=production" "PORT=3000"
nssm set ITSM-App AppStdout "C:\itsm\logs\out.log"
nssm set ITSM-App AppStderr "C:\itsm\logs\error.log"

# Iniciar el servicio:
Start-Service ITSM-App

# Ver estado:
Get-Service ITSM-App
```

---

## W9. Configurar proxy inverso en Windows

### Opción A — nginx para Windows

```powershell
# Editar la config de nginx
notepad C:\tools\nginx\conf\nginx.conf
```

Reemplaza el bloque `server` existente con:

```nginx
server {
    listen       80;
    server_name  _;

    client_max_body_size 25M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
    }
}
```

```powershell
# Recargar configuración de nginx (sin detenerlo):
Start-Process "C:\tools\nginx\nginx.exe" -ArgumentList "-s reload"
```

### Registrar nginx como servicio de Windows

```powershell
# Con NSSM:
nssm install nginx "C:\tools\nginx\nginx.exe"
nssm set nginx AppDirectory "C:\tools\nginx"
Start-Service nginx
Set-Service nginx -StartupType Automatic
```

### Opción B — IIS con Application Request Routing

Si el servidor ya tiene IIS instalado:

1. Instala los módulos en PowerShell como Admin:

```powershell
# Habilitar IIS con los módulos necesarios
Install-WindowsFeature -Name Web-Server, Web-WebSockets -IncludeManagementTools

# Instala ARR y URL Rewrite descargando desde el sitio de Microsoft
# ARR:        https://www.iis.net/downloads/microsoft/application-request-routing
# URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite
```

2. Abre **IIS Manager** → Selecciona el servidor → **Application Request Routing Cache** → **Server Proxy Settings** → habilita "Enable proxy".

3. Crea un nuevo sitio en IIS que apunte a `http://localhost:3000` con URL Rewrite inverso.

> nginx para Windows es más simple de configurar. IIS se recomienda solo si ya lo tienes en uso en el servidor.

### Abrir el puerto 80 en el Firewall de Windows

```powershell
New-NetFirewallRule -DisplayName "ITSM HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "ITSM HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# Asegurarse de que 3306 y 6379 NO están expuestos al exterior
# (por defecto Windows Firewall los bloquea si no los abriste)
```

---

## W10. Verificar que todo funciona Windows

Desde el mismo servidor:

```powershell
# 1. Health check directo a la app
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing | Select-Object -ExpandProperty Content

# 2. Health check a través del proxy (nginx o IIS en puerto 80)
Invoke-WebRequest http://localhost/health -UseBasicParsing | Select-Object -ExpandProperty Content

# 3. Liveness probe
Invoke-WebRequest http://localhost:3000/health/live -UseBasicParsing | Select-Object -ExpandProperty Content
```

Todos deben responder algo como: `{"db":"ok","redis":"ok","alive":true}`

Desde **tu máquina** (fuera del servidor):

```powershell
# Reemplaza con la IP real del servidor Windows
Invoke-WebRequest http://192.168.1.100/health -UseBasicParsing
```

### Verificar la BD

```powershell
mysql -u itsm_user -p equipment_management -e "SHOW TABLES;"
# Debe listar ~25 tablas
```

### Verificar Redis / Memurai

```powershell
# Si usas Memurai:
memurai-cli ping   # responde: PONG

# Si usas Docker:
docker compose exec redis redis-cli ping   # responde: PONG
```

---

## W11. Arranque automático y logs Windows

### Con Docker Desktop

```powershell
# Ver estado de contenedores:
docker compose ps

# Ver logs en tiempo real:
docker compose logs -f app

# Reiniciar solo la app:
docker compose restart app
```

### Con PM2 / NSSM

```powershell
# Ver estado:
pm2 list
# o:
Get-Service ITSM-App

# Ver logs:
pm2 logs itsm-app
# o abrir directamente:
Get-Content C:\itsm\logs\out.log -Tail 50

# Reiniciar:
pm2 restart itsm-app
# o:
Restart-Service ITSM-App

# Actualizar código:
# 1. Copiar nuevos archivos a C:\itsm\
# 2. cd C:\itsm && npm ci --omit=dev && npm run migrate
# 3. pm2 restart itsm-app  (o Restart-Service ITSM-App)
```

### Configurar backup diario con Tarea Programada

El script `backup.sh` es para Linux. En Windows, crea un script PowerShell equivalente:

```powershell
# Crear script de backup
@"
`$date = Get-Date -Format "yyyyMMdd_HHmmss"
`$dest = "C:\backups\itsm_`$date.sql"
`$env:MYSQL_PWD = "UnaPasswordSegura123!"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" `
    --host=localhost --user=itsm_user --single-transaction `
    equipment_management | Out-File -Encoding utf8 `$dest
Compress-Archive -Path `$dest -DestinationPath "`$dest.zip" -Force
Remove-Item `$dest
# Eliminar backups de más de 30 días
Get-ChildItem "C:\backups\itsm_*.sql.zip" | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
Write-Host "Backup completado: `$dest.zip"
"@ | Out-File -Encoding utf8 C:\itsm\scripts\backup-windows.ps1

# Crear carpeta de backups
New-Item -ItemType Directory -Path C:\backups -Force
```

Registrar como Tarea Programada:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
           -Argument "-NonInteractive -File C:\itsm\scripts\backup-windows.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "ITSM-Backup-Diario" `
    -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Highest -Force

# Ejecutar manualmente para probar:
Start-ScheduledTask -TaskName "ITSM-Backup-Diario"
```

---

## W12. Checklist final Windows

```
INFRAESTRUCTURA
[ ] RDP funciona (puerto 3389 abierto)
[ ] Puertos 80/443 abiertos en Firewall de Windows
[ ] Puertos 3306/6379 cerrados al exterior (no aparecen en reglas de entrada)
[ ] Node.js v20 instalado: node --version
[ ] MySQL corriendo: Get-Service MySQL → Running
[ ] Redis/Memurai corriendo: memurai-cli ping → PONG  (o Docker)
[ ] nginx/IIS corriendo como servicio: Get-Service nginx → Running

APLICACIÓN
[ ] Proyecto en C:\itsm
[ ] .env configurado con valores reales (no los del ejemplo)
[ ] node scripts/utilities/check-env.js → sin errores
[ ] npm run migrate → 26 migraciones ejecutadas sin error
[ ] Invoke-WebRequest http://localhost:3000/health → {"db":"ok","redis":"ok"}
[ ] Invoke-WebRequest http://localhost/health → mismo resultado por el proxy

BASE DE DATOS
[ ] BD importada o migraciones corridas (SHOW TABLES muestra ~25 tablas)
[ ] Usuario itsm_user solo tiene acceso desde localhost
[ ] Tarea Programada de backup creada y probada manualmente

PROCESO
[ ] App arranca sola cuando el servidor reinicia (Docker, NSSM o PM2-startup)
[ ] Logs accesibles: pm2 logs itsm-app o docker compose logs

SEGURIDAD
[ ] JWT_SECRET, JWT_REFRESH_SECRET, SESSION_SECRET cambiados (mínimo 32 chars aleatorios)
[ ] .env NO está en git
[ ] uploads/ existe y tiene permisos de escritura para el proceso node
[ ] Firewall de Windows activo (Get-NetFirewallProfile | Select Name, Enabled)
```

---

## Resumen de comandos clave — Windows

| Acción | Docker Desktop | PM2 / NSSM |
|---|---|---|
| Ver estado | `docker compose ps` | `pm2 list` / `Get-Service ITSM-App` |
| Ver logs | `docker compose logs -f app` | `pm2 logs itsm-app` |
| Reiniciar app | `docker compose restart app` | `pm2 restart itsm-app` |
| Apagar todo | `docker compose down` | `pm2 stop itsm-app` |
| Actualizar código | `docker compose up -d --build` | copiar archivos → `npm ci` → `npm run migrate` → reiniciar |
| Correr migraciones | Automático al reiniciar | `npm run migrate` |
| Acceder a MySQL | `docker compose exec mysql mysql -u root -p` | `mysql -u itsm_user -p` |
| Ver backup | — | `Get-ChildItem C:\backups\` |

---

*Generado: Mayo 2026 — ITSM Multi-Tenant SaaS v1.0*

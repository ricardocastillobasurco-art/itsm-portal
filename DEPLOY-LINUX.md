# Guía de Despliegue en Linux — On-Premise
### Equipment Management System · Guía para principiantes

---

## ¿Qué vamos a hacer?

Vamos a instalar tu aplicación Node.js en un servidor Linux real para que:

- **Arranque automáticamente** cuando el servidor encienda
- **Se reinicie sola** si falla por algún error
- **La base de datos nunca se caiga** y persista aunque reinicies el servidor
- **Las actualizaciones** se apliquen sin que los usuarios noten nada
- **Los logs** queden guardados para poder diagnosticar problemas
- **La comunicación esté cifrada** con HTTPS desde el primer día
- **El servidor esté endurecido** contra accesos no autorizados

**Componentes que instalaremos:**

| Componente | Para qué sirve |
|---|---|
| Ubuntu Server 22.04 LTS | El sistema operativo del servidor |
| Node.js 20 LTS | Ejecutar tu aplicación |
| **PostgreSQL 16** | Base de datos principal (más robusta que MySQL) |
| Redis | Sesiones de usuario y colas de trabajo |
| PM2 | Mantener la app corriendo y reiniciarla si falla |
| Nginx | Reverse proxy con HTTPS |
| mkcert | Certificado SSL para la red interna |
| Fail2ban | Bloquear intentos de acceso por fuerza bruta |
| Lynis | Auditoría de seguridad del servidor |

---

## ¿Por qué PostgreSQL en lugar de MySQL?

| | MySQL | PostgreSQL |
|---|---|---|
| Tipos de datos | Básicos | JSON nativo, arrays, rangos, UUID |
| Integridad | Buena | Excelente — ACID estricto |
| Seguridad por defecto | Requiere configuración manual | Más restrictivo por defecto |
| Rendimiento en consultas complejas | Moderado | Superior |
| Soporte futuro | Mantenido por Oracle | Comunidad activa, sin vendor lock-in |
| Secuelas ORM | Soportado | Soportado + mejor soporte de tipos |

Tu proyecto **ya tiene Sequelize preparado** para el cambio — el comentario en `src/config/database.js` dice exactamente eso. El esfuerzo de migración es bajo.

---

## Cambios en el código para PostgreSQL

Antes de desplegar, hay que hacer estos cambios en el proyecto:

### 1. Cambiar dependencias

```bash
# En tu máquina de desarrollo
npm uninstall mysql2
npm install pg pg-hstore
```

### 2. Actualizar `src/config/database.js`

Cambiar las líneas:
```javascript
// ANTES:
dialect: 'mysql',
port:    parseInt(process.env.EQUIPMENT_PORT) || 3306,
dialectOptions: {
    connectTimeout: 5000,
},

// DESPUÉS:
dialect: 'postgres',
port:    parseInt(process.env.EQUIPMENT_PORT) || 5432,
dialectOptions: {
    connectTimeout: 5000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
},
```

### 3. Verificar queries SQL con sintaxis MySQL

PostgreSQL no acepta comillas invertidas `` ` `` para nombres de columnas/tablas — usa comillas dobles `"` o simplemente sin comillas. Busca en el código:

```bash
# Buscar queries con backticks (sintaxis MySQL)
grep -rn "SELECT.*\`" routes/ --include="*.js"
grep -rn "UPDATE.*\`" routes/ --include="*.js"
```

Si encuentras backticks en queries SQL directas (no en Sequelize), cámbialos por comillas dobles o elimínalos si el nombre es simple.

### 4. Actualizar el `.env`

```env
# Cambiar estas líneas:
EQUIPMENT_PORT=5432          # era 3306
DB_SSL=false                 # false en red local, true si hay SSL en la BD
```

> **Nota:** Las migraciones de Sequelize ya usarán PostgreSQL automáticamente. No necesitas reescribirlas.

---

## Requisitos previos

- Un servidor o PC con **Ubuntu Server 22.04 LTS** instalado
- Acceso por **SSH** o directamente a la terminal del servidor
- Tu proyecto en un **repositorio Git** (GitLab, GitHub, etc.)
- Tu archivo `.env` con las configuraciones reales de producción

> **¿Qué es SSH?** Es una forma de conectarte a otro computador por la red y escribir comandos en él desde tu PC. Si el servidor está físicamente frente a ti, puedes escribir directamente en él.

---

## Cómo conectarte al servidor (SSH)

Desde tu máquina Windows, abre PowerShell:

```powershell
ssh usuario@IP-DEL-SERVIDOR
# Ejemplo:
ssh ricardo@192.168.1.100
```

Una vez dentro verás algo como:
```
ricardo@servidor:~$
```
Todo lo que escribas a partir de ahí se ejecuta en el servidor.

---

## PASO 1 — Actualizar el sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

Vuelve a conectarte por SSH después de 30 segundos.

---

## PASO 2 — Crear usuario dedicado para la app

**La app nunca debe correr como root.** Si alguien explota una vulnerabilidad en Node.js, solo tendrá acceso al usuario `appuser`, no al sistema completo.

```bash
# Crear usuario sin shell interactiva (no puede hacer login)
sudo adduser --system --group --no-create-home appuser

# Crear la carpeta de la app con permisos correctos
sudo mkdir -p /var/www/equipment-app
sudo chown appuser:appuser /var/www/equipment-app
sudo chmod 750 /var/www/equipment-app
# 750 = el dueño (appuser) puede todo, su grupo puede leer/ejecutar, el resto NADA

# Carpeta de logs
sudo mkdir -p /var/log/equipment-app
sudo chown appuser:appuser /var/log/equipment-app
```

---

## PASO 3 — Instalar Node.js 20

```bash
# Instalar NVM (gestor de versiones de Node)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Instalar Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verificar
node --version    # v20.x.x
npm --version     # 10.x.x

# Instalar PM2 globalmente
npm install -g pm2
```

---

## PASO 4 — Instalar PostgreSQL 16

```bash
# Agregar repositorio oficial de PostgreSQL (versión más actualizada)
sudo apt install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'

sudo apt update
sudo apt install -y postgresql-16

# Verificar que está corriendo
sudo systemctl status postgresql
# Debe mostrar "active (running)"

# Activar inicio automático
sudo systemctl enable postgresql
```

### Configurar la base de datos

```bash
# Entrar como el usuario postgres (administrador de PostgreSQL)
sudo -u postgres psql
```

Dentro del prompt de PostgreSQL (`postgres=#`):

```sql
-- Crear usuario para la app (CAMBIA la contraseña)
CREATE USER app_user WITH PASSWORD 'CONTRASEÑA_SEGURA_AQUI';

-- Crear la base de datos
CREATE DATABASE equipment_management
    WITH OWNER = app_user
    ENCODING = 'UTF8'
    LC_COLLATE = 'es_PE.UTF-8'
    LC_CTYPE = 'es_PE.UTF-8'
    TEMPLATE = template0;

-- Si el locale no existe, usar el genérico:
-- LC_COLLATE = 'en_US.UTF-8' LC_CTYPE = 'en_US.UTF-8'

-- Dar todos los privilegios
GRANT ALL PRIVILEGES ON DATABASE equipment_management TO app_user;

-- Verificar
\l                       -- listar bases de datos
\du                      -- listar usuarios
\q                       -- salir
```

### Configurar acceso local seguro

PostgreSQL usa un sistema llamado `pg_hba.conf` para controlar quién puede conectarse:

```bash
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

Busca la sección `# IPv4 local connections:` y deja solo esto:

```
# TYPE  DATABASE        USER            ADDRESS         METHOD
local   all             postgres                        peer
local   all             all                             scram-sha-256
host    all             all             127.0.0.1/32    scram-sha-256
```

Esto significa: solo conexiones desde `localhost`, con contraseña cifrada (scram-sha-256). Nadie de fuera puede conectarse directamente a la base de datos.

```bash
sudo systemctl reload postgresql
```

### Probar la conexión

```bash
psql -h 127.0.0.1 -U app_user -d equipment_management
# Pide contraseña → escribir CONTRASEÑA_SEGURA_AQUI
# Si entra al prompt "equipment_management=>", todo está bien
\q   # salir
```

### Importar datos existentes (si tienes backup de MySQL)

Si venías de MySQL, necesitas migrar los datos:

```bash
# Opción 1: si las tablas son nuevas, solo ejecuta las migraciones de Sequelize (recomendado)
# Las migraciones crean la estructura desde cero en PostgreSQL

# Opción 2: si tienes datos que migrar, usar pgloader (convierte MySQL → PostgreSQL)
sudo apt install pgloader -y
pgloader mysql://app_user:PASS@localhost/equipment_management \
          postgresql://app_user:PASS@localhost/equipment_management
```

---

## PASO 5 — Instalar Redis

```bash
sudo apt install redis-server -y
sudo systemctl enable redis-server
```

### Configurar seguridad de Redis

```bash
sudo nano /etc/redis/redis.conf
```

Modificar:

```conf
# Solo acepta conexiones locales
bind 127.0.0.1 -::1

# Contraseña obligatoria
requirepass TU_REDIS_PASSWORD_FUERTE

# Límite de memoria (ajustar según tu RAM disponible)
maxmemory 256mb
maxmemory-policy allkeys-lru
```

```bash
sudo systemctl restart redis-server

# Probar
redis-cli -a TU_REDIS_PASSWORD_FUERTE ping
# Respuesta: PONG
```

---

## PASO 6 — Subir la aplicación

```bash
# Instalar Git
sudo apt install git -y

# Clonar el repositorio como appuser
sudo -u appuser git clone https://URL-DE-TU-REPO.git /var/www/equipment-app

cd /var/www/equipment-app

# Instalar dependencias de producción (sin devDependencies)
sudo -u appuser npm ci --omit=dev
```

---

## PASO 7 — Crear el archivo .env de producción

```bash
sudo -u appuser nano /var/www/equipment-app/.env
```

Contenido completo:

```env
# ── Servidor ──────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
APP_URL=https://IP-DEL-SERVIDOR

# ── PostgreSQL ────────────────────────────────────────────────────────
EQUIPMENT_HOST=localhost
EQUIPMENT_USER=app_user
EQUIPMENT_PASSWORD=CONTRASEÑA_SEGURA_AQUI
EQUIPMENT_DATABASE=equipment_management
EQUIPMENT_PORT=5432
DB_SSL=false

# ── Redis ──────────────────────────────────────────────────────────────
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=TU_REDIS_PASSWORD_FUERTE

# ── Seguridad (usar strings largos y aleatorios, mínimo 64 caracteres) ─
# Generar con: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=GENERA_UN_STRING_LARGO_Y_ALEATORIO_AQUI
JWT_REFRESH_SECRET=OTRO_STRING_DIFERENTE_AL_ANTERIOR
JWT_EXPIRE=59m
SESSION_SECRET=OTRO_STRING_DIFERENTE_PARA_SESIONES

# ── Rate Limiting ─────────────────────────────────────────────────────
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX_REQUESTS=500

# ── Jira ──────────────────────────────────────────────────────────────
JIRA_HOST=https://tu-empresa.atlassian.net
JIRA_EMAIL=tu@empresa.com
JIRA_API_TOKEN=tu_token_de_jira

# ── Microsoft Azure ───────────────────────────────────────────────────
MS_CLIENT_ID=
MS_TENANT_ID=
MS_CLIENT_SECRET=
MS_USER_EMAIL=

# ── Email SMTP ────────────────────────────────────────────────────────
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu@empresa.com
SMTP_PASS=tu_contraseña_smtp
MAIL_FROM_NAME=tu@empresa.com

# ── App ───────────────────────────────────────────────────────────────
ALLOWED_ORIGINS=https://IP-DEL-SERVIDOR
```

```bash
# Proteger el archivo — SOLO appuser puede leerlo
sudo chmod 600 /var/www/equipment-app/.env
sudo chown appuser:appuser /var/www/equipment-app/.env

# Generar secrets seguros (ejecuta esto y copia los valores al .env)
node -e "const c=require('crypto');console.log('JWT_SECRET='+c.randomBytes(64).toString('hex'));console.log('JWT_REFRESH_SECRET='+c.randomBytes(64).toString('hex'));console.log('SESSION_SECRET='+c.randomBytes(64).toString('hex'));"
```

---

## PASO 8 — Ejecutar migraciones

```bash
cd /var/www/equipment-app
sudo -u appuser npm run migrate
```

---

## PASO 9 — Configurar PM2

```bash
sudo -u appuser nano /var/www/equipment-app/ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'equipment-app',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',

    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },

    error_file: '/var/log/equipment-app/error.log',
    out_file:   '/var/log/equipment-app/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,

    max_memory_restart: '500M',
    max_restarts: 10,
    min_uptime: '10s',
    autorestart: true,
  }]
};
```

```bash
# Iniciar como appuser
sudo -u appuser pm2 start /var/www/equipment-app/ecosystem.config.js --env production

# Verificar
sudo -u appuser pm2 status

# Configurar inicio automático
sudo env PATH=$PATH:$(which node) pm2 startup systemd -u appuser --hp /home/appuser
sudo -u appuser pm2 save

# Probar que la app responde
curl http://localhost:3000/health
```

---

## PASO 10 — HTTPS con certificado SSL

### ¿Por qué HTTPS desde el primer día?

En una red local sin HTTPS:
- Las contraseñas viajan en texto plano por la red
- Cualquier equipo en el mismo switch puede capturar las sesiones con Wireshark
- Los tokens JWT y cookies de sesión son visibles
- Herramientas de auditoría de seguridad marcan la app como insegura

**La regla es simple: si hay usuarios reales, hay HTTPS.**

### Opción A: mkcert (recomendado para red interna sin dominio)

`mkcert` crea una Autoridad Certificadora (CA) local que tus equipos pueden confiar. Los navegadores no muestran advertencias.

```bash
# Instalar mkcert en el SERVIDOR
sudo apt install libnss3-tools -y
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert

# Crear la CA local
mkcert -install

# Crear el certificado para la IP de tu servidor
# Reemplaza 192.168.1.100 con la IP real de tu servidor
mkcert 192.168.1.100 localhost 127.0.0.1

# Esto genera dos archivos:
# 192.168.1.100+2.pem      ← certificado
# 192.168.1.100+2-key.pem  ← clave privada

# Mover a carpeta segura
sudo mkdir -p /etc/ssl/equipment-app
sudo mv 192.168.1.100+2.pem     /etc/ssl/equipment-app/cert.pem
sudo mv 192.168.1.100+2-key.pem /etc/ssl/equipment-app/key.pem
sudo chmod 640 /etc/ssl/equipment-app/key.pem
sudo chown root:www-data /etc/ssl/equipment-app/key.pem
```

**Instalar el CA en cada equipo de la red** (para que no salga advertencia en el navegador):

```bash
# En el servidor, obtener el archivo CA para distribuir
mkcert -CAROOT
# Muestra la ruta, ejemplo: /root/.local/share/mkcert

# Copiar rootCA.pem a los equipos Windows
# En cada Windows: doble clic en rootCA.pem → Instalar certificado → 
# Almacén: "Entidades de certificación raíz de confianza"
```

### Opción B: Let's Encrypt con Certbot (cuando tengas dominio)

Si en el futuro tienes un dominio que apunte al servidor:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d tu-dominio.com
# Certbot se renueva automáticamente cada 90 días
```

### Configurar Nginx con HTTPS

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/equipment-app
```

```nginx
# Redirigir HTTP → HTTPS
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

# Servidor HTTPS principal
server {
    listen 443 ssl;
    server_name _;

    # Certificados SSL
    ssl_certificate     /etc/ssl/equipment-app/cert.pem;
    ssl_certificate_key /etc/ssl/equipment-app/key.pem;

    # Protocolos seguros (deshabilita TLS 1.0 y 1.1 obsoletos)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS — el navegador recuerda usar HTTPS por 1 año
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Tamaño máximo de uploads (ajustar al límite de multer)
    client_max_body_size 15M;

    # Archivos estáticos — Nginx los sirve directamente
    location /public/ {
        alias /var/www/equipment-app/public/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    location /uploads/ {
        alias /var/www/equipment-app/uploads/;
    }

    # WebSocket de Socket.io
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Todo lo demás → Node.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;

        # Headers de seguridad
        add_header X-Frame-Options "SAMEORIGIN";
        add_header X-Content-Type-Options "nosniff";
        add_header Referrer-Policy "strict-origin-when-cross-origin";
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()";
    }

    access_log /var/log/nginx/equipment-app.access.log;
    error_log  /var/log/nginx/equipment-app.error.log;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/equipment-app /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t         # verificar sintaxis — debe decir "test is successful"
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## PASO 11 — Seguridad del servidor

Esta sección cubre las prácticas que exige cualquier auditoría de seguridad de la información (ISO 27001, CIS Benchmark).

### 11.1 — Firewall

```bash
sudo ufw allow ssh           # puerto 22 — acceso remoto
sudo ufw allow http          # puerto 80 — redirige a HTTPS
sudo ufw allow https         # puerto 443 — tu app

# Los puertos 3000, 5432 (PostgreSQL), 6379 (Redis) NO se abren
# Solo son accesibles internamente (localhost)

sudo ufw enable
sudo ufw status verbose
```

### 11.2 — SSH con claves (sin contraseñas)

Autenticarse con contraseña por SSH es vulnerable a fuerza bruta. Las claves criptográficas son prácticamente imposibles de romper.

**En tu PC Windows (PowerShell):**

```powershell
# Generar un par de claves SSH (si no tienes uno)
ssh-keygen -t ed25519 -C "ricardo@empresa"
# Presiona Enter para aceptar la ruta por defecto
# Opcionalmente agrega una passphrase (recomendado)

# Copiar la clave pública al servidor
ssh-copy-id usuario@IP-DEL-SERVIDOR
# Pide la contraseña del servidor por ÚLTIMA vez
```

**En el servidor, deshabilitar login con contraseña:**

```bash
sudo nano /etc/ssh/sshd_config
```

Buscar y cambiar/agregar estas líneas:

```
PasswordAuthentication no       # no más contraseñas
PermitRootLogin no              # root no puede entrar por SSH nunca
PubkeyAuthentication yes        # solo claves SSH
AuthorizedKeysFile .ssh/authorized_keys
MaxAuthTries 3                  # 3 intentos fallidos y corta la conexión
ClientAliveInterval 300         # desconectar sesiones inactivas >5 min
ClientAliveCountMax 2
```

```bash
sudo systemctl restart sshd

# IMPORTANTE: abre OTRA ventana SSH antes de cerrar la actual
# para verificar que puedes seguir entrando con la clave
```

### 11.3 — Fail2ban (bloqueo de fuerza bruta)

Fail2ban monitorea los logs y bloquea IPs que intentan demasiados accesos fallidos.

```bash
sudo apt install fail2ban -y

sudo nano /etc/fail2ban/jail.local
```

```ini
[DEFAULT]
# Banear por 1 hora a quien falle 5 veces en 10 minutos
bantime  = 3600
findtime = 600
maxretry = 5

# Proteger SSH
[sshd]
enabled = true
port    = ssh
logpath = /var/log/auth.log

# Proteger Nginx (ataques a la app)
[nginx-http-auth]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/equipment-app.error.log
maxretry = 5

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/equipment-app.error.log
maxretry = 10
```

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Ver IPs baneadas
sudo fail2ban-client status sshd
```

### 11.4 — Actualizaciones automáticas de seguridad

El equipo de seguridad de tu organización seguramente preguntará: "¿está el servidor parchado?". Esto lo automatiza:

```bash
sudo apt install unattended-upgrades -y

sudo nano /etc/apt/apt.conf.d/50unattended-upgrades
```

Descomentar y ajustar:

```
// Solo instalar actualizaciones de seguridad automáticamente
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};

// Reiniciar automáticamente SI es necesario (a las 3 AM)
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";

// Enviar reporte por email (si tienes SMTP configurado)
Unattended-Upgrade::Mail "tu@empresa.com";
Unattended-Upgrade::MailReport "on-change";
```

```bash
sudo dpkg-reconfigure -plow unattended-upgrades
# Seleccionar "Yes"

# Verificar que funciona
sudo unattended-upgrades --dry-run --debug
```

### 11.5 — Permisos del código fuente

El código del proyecto solo debe ser legible por el usuario que lo ejecuta. Si alguien compromise Nginx, no puede leer el código ni el `.env`:

```bash
# El dueño es appuser, permisos 750 (grupo y otros no pueden leer)
sudo chown -R appuser:appuser /var/www/equipment-app
sudo chmod -R 750 /var/www/equipment-app

# .env solo lo lee appuser
sudo chmod 600 /var/www/equipment-app/.env

# Los uploads son accesibles por Nginx (www-data necesita leer)
sudo chown -R appuser:www-data /var/www/equipment-app/uploads
sudo chmod -R 755 /var/www/equipment-app/uploads
```

### 11.6 — Rotación de logs

```bash
sudo nano /etc/logrotate.d/equipment-app
```

```
/var/log/equipment-app/*.log {
    daily
    rotate 90
    compress
    delaycompress
    missingok
    notifempty
    create 0640 appuser appuser
    postrotate
        su appuser -c "pm2 reloadLogs"
    endscript
}
```

---

## PASO 12 — Monitoreo y cumplimiento de seguridad

Esta sección responde directamente a lo que el área de Seguridad de la Información pedirá: evidencia de que el servidor está monitoreado, auditado y parcheado.

### 12.1 — Lynis: auditoría de seguridad

Lynis revisa el servidor completo y da un puntaje de seguridad con recomendaciones específicas. Es lo que usa un auditor para verificar el cumplimiento.

```bash
sudo apt install lynis -y

# Ejecutar auditoría completa
sudo lynis audit system

# Al final muestra:
# - Hardening index: 67 [########### ] (mayor es mejor, objetivo > 70)
# - Warnings: problemas importantes
# - Suggestions: mejoras recomendadas
# - Guardar el reporte
sudo lynis audit system --report-file /var/log/lynis-report.dat
```

Ejecutar Lynis mensualmente y comparar el score:

```bash
# Agregar al crontab para auditoría mensual automática
sudo crontab -e
# Agregar:
0 4 1 * * lynis audit system --cronjob >> /var/log/lynis-monthly.log 2>&1
```

### 12.2 — Auditd: registro de quién hace qué

`auditd` es el sistema de auditoría del kernel de Linux. Registra accesos a archivos sensibles — útil cuando seguridad pregunta "¿alguien accedió al .env?".

```bash
sudo apt install auditd -y
sudo systemctl enable auditd

# Definir qué monitorear
sudo auditctl -w /var/www/equipment-app/.env -p rwxa -k env-access
sudo auditctl -w /etc/postgresql/ -p rwxa -k postgres-config
sudo auditctl -w /etc/ssh/sshd_config -p rwxa -k ssh-config

# Ver eventos registrados
sudo ausearch -k env-access
sudo ausearch -k env-access --start today
```

Para que las reglas sean permanentes:

```bash
sudo nano /etc/audit/rules.d/equipment-app.rules
```

```
# Monitorear acceso al .env
-w /var/www/equipment-app/.env -p rwxa -k env-access

# Monitorear cambios en configuración de PostgreSQL
-w /etc/postgresql/ -p rwxa -k postgres-config

# Monitorear cambios en SSH
-w /etc/ssh/sshd_config -p rwxa -k ssh-config

# Monitorear ejecución de comandos con sudo
-a always,exit -F arch=b64 -S execve -F euid=0 -k sudo-commands
```

```bash
sudo systemctl restart auditd
```

### 12.3 — Monitoreo de integridad de archivos (AIDE)

AIDE detecta si alguien modificó archivos del sistema o del código sin autorización. Seguridad de la información lo considera un control crítico.

```bash
sudo apt install aide -y

# Crear la base de datos inicial (snapshot del estado actual)
sudo aideinit
sudo mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db

# Verificar integridad (compara estado actual vs snapshot)
sudo aide --check
# Sin cambios → OK
# Con cambios → lista qué archivos fueron modificados

# Automatizar verificación diaria
sudo crontab -e
# Agregar:
0 5 * * * aide --check >> /var/log/aide-check.log 2>&1
```

### 12.4 — Health check y alerta automática

```bash
sudo nano /opt/scripts/healthcheck.sh
```

```bash
#!/bin/bash
HEALTH=$(curl -sk https://localhost/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','ERR'))" 2>/dev/null)

if [ "$HEALTH" != "OK" ]; then
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "$TIMESTAMP — App no responde (status: $HEALTH), reiniciando..." >> /var/log/healthcheck.log

    # Reiniciar la app
    su appuser -c "pm2 restart equipment-app"

    # Enviar alerta por email (requiere mailutils instalado)
    # echo "La app equipment-app se reinició automáticamente a $TIMESTAMP" | \
    #   mail -s "[ALERTA] Servidor reiniciado" tu@empresa.com
fi
```

```bash
sudo chmod +x /opt/scripts/healthcheck.sh
sudo mkdir -p /opt/scripts

# Ejecutar cada 5 minutos
sudo crontab -e
# Agregar:
*/5 * * * * /opt/scripts/healthcheck.sh
```

---

## PASO 13 — Backups automáticos

### Backup de PostgreSQL

```bash
sudo mkdir -p /var/backups/postgresql
sudo chown appuser:appuser /var/backups/postgresql

sudo nano /opt/scripts/backup-db.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M)
BACKUP_DIR="/var/backups/postgresql"
DB_USER="app_user"
DB_NAME="equipment_management"

# pg_dump crea un backup limpio y consistente
PGPASSWORD="CONTRASEÑA_SEGURA_AQUI" pg_dump \
    -h localhost \
    -U $DB_USER \
    -d $DB_NAME \
    --no-password \
    --format=custom \
    --compress=9 \
    --file="$BACKUP_DIR/backup_$DATE.dump"

# Verificar que el backup se creó
if [ $? -eq 0 ]; then
    echo "$(date): Backup OK → backup_$DATE.dump ($(du -sh $BACKUP_DIR/backup_$DATE.dump | cut -f1))"
else
    echo "$(date): ERROR en el backup" >&2
fi

# Eliminar backups con más de 30 días
find $BACKUP_DIR -name "*.dump" -mtime +30 -delete
```

```bash
sudo chmod +x /opt/scripts/backup-db.sh

# Probar
sudo -u appuser /opt/scripts/backup-db.sh

# Programar a las 2:00 AM
sudo crontab -u appuser -e
# Agregar:
0 2 * * * /opt/scripts/backup-db.sh >> /var/log/backup-db.log 2>&1
```

### Restaurar un backup (cuando sea necesario)

```bash
# Listar backups disponibles
ls -lh /var/backups/postgresql/

# Restaurar (esto SOBREESCRIBE la base de datos actual)
PGPASSWORD="CONTRASEÑA" pg_restore \
    -h localhost \
    -U app_user \
    -d equipment_management \
    --clean \
    /var/backups/postgresql/backup_20260101_0200.dump
```

---

## Comandos del día a día

### Estado del sistema

```bash
pm2 status                                    # estado de la app
pm2 logs equipment-app                        # logs en tiempo real
pm2 logs equipment-app --err --lines 50       # solo errores

sudo systemctl status postgresql              # base de datos
sudo systemctl status redis-server            # redis
sudo systemctl status nginx                   # nginx
sudo systemctl status fail2ban                # protección bruta

curl -sk https://localhost/health             # respuesta de la app

sudo fail2ban-client status sshd             # IPs baneadas por SSH
sudo fail2ban-client status nginx-http-auth  # IPs baneadas por Nginx
```

### Deploy sin downtime (cada actualización)

```bash
cd /var/www/equipment-app

# 1. Bajar código nuevo
sudo -u appuser git pull origin main

# 2. Actualizar dependencias si cambiaron
sudo -u appuser npm ci --omit=dev

# 3. Migraciones nuevas (si las hay)
sudo -u appuser npm run migrate

# 4. Recargar sin cortar conexiones activas
sudo -u appuser pm2 reload equipment-app --update-env

# 5. Verificar
pm2 status
curl -sk https://localhost/health
```

### Ver espacio en disco

```bash
df -h                                         # espacio total por partición
du -sh /var/log/equipment-app/                # logs de la app
du -sh /var/backups/postgresql/               # tamaño de backups
du -sh /var/www/equipment-app/uploads/        # archivos subidos
```

### Ver intentos de intrusión

```bash
# Intentos de login SSH fallidos
sudo grep "Failed password" /var/log/auth.log | tail -20

# IPs bloqueadas por Fail2ban
sudo fail2ban-client status

# Accesos al .env (auditd)
sudo ausearch -k env-access --start today

# Cambios en archivos del sistema (AIDE)
sudo aide --check
```

---

## Diagnóstico de problemas comunes

### La app no inicia

```bash
sudo -u appuser pm2 logs equipment-app --err --lines 50
# O iniciar manualmente para ver el error:
cd /var/www/equipment-app && sudo -u appuser node server.js
```

### PostgreSQL no conecta

```bash
sudo systemctl status postgresql
psql -h 127.0.0.1 -U app_user -d equipment_management
sudo journalctl -u postgresql -n 50
```

### Redis no conecta

```bash
sudo systemctl status redis-server
redis-cli -a TU_REDIS_PASSWORD_FUERTE ping
sudo journalctl -u redis-server -n 50
```

### Error 502 en el navegador

Significa que Nginx está vivo pero Node.js no responde:

```bash
pm2 status
curl http://localhost:3000/health
pm2 restart equipment-app
```

### Certificado SSL no reconocido en navegador

El equipo no tiene instalado el CA de mkcert:
```bash
# En el servidor, obtener la ruta del CA
mkcert -CAROOT
# Copiar rootCA.pem a los equipos Windows e instalarlo manualmente
```

---

## Checklist de verificación final

Antes de declarar el servidor listo para producción, verifica cada punto:

**Funcionalidad:**
- [ ] `curl -sk https://localhost/health` responde `{"status":"OK"...}`
- [ ] La app abre desde el navegador en HTTPS sin advertencia
- [ ] Login funciona correctamente
- [ ] Sesiones persisten al recargar
- [ ] Los tickets Jira se crean y cierran correctamente
- [ ] Los emails se envían

**Seguridad:**
- [ ] HTTPS activo — HTTP redirige a HTTPS
- [ ] `sudo ufw status` muestra solo puertos 22, 80, 443
- [ ] Login SSH con contraseña desactivado (`PasswordAuthentication no`)
- [ ] Fail2ban activo (`sudo fail2ban-client status`)
- [ ] `ls -la /var/www/equipment-app/.env` muestra `-rw------- appuser` (600)
- [ ] `ls -la /var/www/equipment-app/` muestra `drwxr-x--- appuser` (750)
- [ ] Unattended-upgrades configurado

**Disponibilidad:**
- [ ] Reiniciar el servidor (`sudo reboot`) y verificar que todo arranca solo
- [ ] PM2 arranca automáticamente (`pm2 status` sin haber iniciado nada)
- [ ] PostgreSQL arranca automáticamente
- [ ] Redis arranca automáticamente
- [ ] Nginx arranca automáticamente

**Backups y monitoreo:**
- [ ] Existe al menos un backup en `/var/backups/postgresql/`
- [ ] Restauración del backup probada al menos una vez
- [ ] Lynis ejecutado con score > 65
- [ ] Auditd corriendo (`sudo systemctl status auditd`)
- [ ] AIDE inicializado (`/var/lib/aide/aide.db` existe)

---

## Resumen de la arquitectura

```
 USUARIO (navegador)
       │
       │ HTTPS puerto 443 (cifrado)
       ▼
   ┌──────────────────────────────┐
   │           Nginx              │
   │  - Termina SSL               │
   │  - Sirve archivos estáticos  │
   │  - Protege puertos internos  │
   └───────────┬──────────────────┘
               │ HTTP localhost:3000 (interno)
               ▼
   ┌──────────────────────────────┐
   │        Node.js (PM2)         │
   │  - usuario: appuser          │
   │  - Bull Workers              │
   │  - node-cron jobs            │
   │  - Socket.io                 │
   └──────────┬───────────────────┘
              │
     ┌─────────┴──────────┐
     ▼                    ▼
┌──────────────┐   ┌──────────────┐
│ PostgreSQL   │   │    Redis     │
│ :5432        │   │   :6379      │
│ (solo local) │   │ (solo local) │
└──────────────┘   └──────────────┘

 ┌──────────────────────────────────────┐
 │         Capa de seguridad            │
 │  UFW → solo 22,80,443 al exterior    │
 │  Fail2ban → bloquea fuerza bruta     │
 │  SSH → solo claves, sin contraseñas  │
 │  auditd → quién accede a qué         │
 │  AIDE → integridad de archivos       │
 │  Lynis → auditoría mensual           │
 │  unattended-upgrades → parches auto  │
 └──────────────────────────────────────┘
```

---

## Lo que pedirá Seguridad de la Información y cómo responderlo

| Pregunta de auditoría | Tu respuesta |
|---|---|
| ¿Está el servidor parchado? | `sudo unattended-upgrades --dry-run` — patches automáticos activos |
| ¿Quién tiene acceso al servidor? | Solo por SSH con claves criptográficas, log en `/var/log/auth.log` |
| ¿Se monitorean cambios en archivos críticos? | AIDE activo — base de datos en `/var/lib/aide/aide.db` |
| ¿Hay registro de accesos a datos sensibles? | auditd registra acceso a `.env` y configuración de BD |
| ¿Hay backups? | Diarios a las 2 AM, retención 30 días, log en `/var/log/backup-db.log` |
| ¿Hay cifrado en tránsito? | HTTPS con TLS 1.2/1.3, certificado en `/etc/ssl/equipment-app/` |
| ¿La app corre con privilegios mínimos? | Usuario `appuser` sin shell ni sudo, permisos 750 |
| ¿Hay auditoría del sistema? | Lynis ejecutado mensualmente, reporte en `/var/log/lynis-report.dat` |
| ¿Hay protección contra intrusiones? | Fail2ban bloquea IPs tras 5 intentos fallidos |

---

## Próximos pasos cuando el proyecto crezca

| Cuándo | Qué implementar |
|---|---|
| Cuando tengas dominio propio | Reemplazar mkcert por Let's Encrypt (Certbot) |
| Cuando haya +50 usuarios | PM2 cluster con 2 instancias + Redis adapter para Socket.io |
| Cuando requieras alta disponibilidad | PostgreSQL con replicación streaming |
| Cuando quieras centralizar logs | Instalar Wazuh Agent (SIEM gratuito, reportes de cumplimiento automáticos) |
| Cuando quieras deploys automáticos | GitHub Actions / GitLab CI con deploy por SSH |
| Cuando los uploads crezcan | Migrar a MinIO (S3 compatible, on-premise) |

---

*Guía generada para Equipment Management System — Mayo 2026*
*PostgreSQL 16 · Node.js 20 LTS · Ubuntu Server 22.04 LTS*

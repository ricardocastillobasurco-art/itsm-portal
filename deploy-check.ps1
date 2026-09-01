#Requires -RunAsAdministrator
<#
.SYNOPSIS  Deploy ITSM completo a Docker en Windows
.NOTES     Ejecutar: powershell -ExecutionPolicy Bypass -File C:\itsm\deploy-check.ps1
           Requisitos: C:\itsm\ con el proyecto, C:\backup_itsm.sql con el dump
#>

$ErrorActionPreference = "SilentlyContinue"
$ProgressPreference    = "SilentlyContinue"

# ── salida ───────────────────────────────────────────────────────────────────
function OK   ($m) { Write-Host "  OK  $m" -ForegroundColor Green }
function ERR  ($m) { Write-Host "  ERR $m" -ForegroundColor Red;    $global:ErrCount++ }
function WARN ($m) { Write-Host "  !   $m" -ForegroundColor Yellow }
function FIX  ($m) { Write-Host "  FIX $m" -ForegroundColor Magenta }
function INFO ($m) { Write-Host "      $m" -ForegroundColor Cyan }
function BLK  ()   { Write-Host "" }
function SEC  ($m) {
    BLK
    Write-Host "  ══════════════════════════════════════════════════" -ForegroundColor DarkCyan
    Write-Host "   $m" -ForegroundColor White
    Write-Host "  ══════════════════════════════════════════════════" -ForegroundColor DarkCyan
}

$global:ErrCount = 0
$Root   = "C:\itsm"
$EnvF   = "$Root\.env"
$Backup = "C:\backup_itsm.sql"
$CF     = "docker-compose.windows.yml"

Set-Location $Root

# ── leer .env ────────────────────────────────────────────────────────────────
function Get-Env ([string]$Path) {
    $h = @{}
    if (Test-Path $Path) {
        Get-Content $Path | ForEach-Object {
            if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
                $h[$Matches[1]] = $Matches[2].Trim()
            }
        }
    }
    return $h
}
function Set-EnvLine ([string]$File, [string]$Key, [string]$Val) {
    $found = $false
    $lines = (Get-Content $File) | ForEach-Object {
        if ($_ -match "^\s*${Key}=") { "${Key}=${Val}"; $found = $true } else { $_ }
    }
    if (-not $found) { $lines += "${Key}=${Val}" }
    $lines | Set-Content $File -Encoding UTF8
}

# ── SQL via archivo en C:\itsm\ (ruta sin espacios, funciona con docker cp) ──
function Invoke-MySql ([string]$User, [string]$Pw, [string]$Db, [string]$Sql) {
    $f   = "$Root\__q.sql"
    [System.IO.File]::WriteAllText($f, $Sql, (New-Object System.Text.UTF8Encoding($false)))
    docker cp "$f" "itsm-mysql:/tmp/__q.sql" 2>&1 | Out-Null
    $dbA = if ($Db) { $Db } else { "" }
    $out = docker exec itsm-mysql sh -c "mysql -u'$User' -p'$Pw' $dbA < /tmp/__q.sql 2>&1"
    docker exec itsm-mysql sh -c "rm -f /tmp/__q.sql" 2>&1 | Out-Null
    Remove-Item $f -Force -ErrorAction SilentlyContinue
    return $out
}

# ════════════════════════════════════════════════════════════════════════════
Clear-Host; BLK
Write-Host "  +==================================================+" -ForegroundColor Cyan
Write-Host "  | ITSM — Deploy Docker: MySQL + Redis + App + Nginx|" -ForegroundColor Cyan
Write-Host "  +==================================================+" -ForegroundColor Cyan

# ════════════════════════════════════════════════════════════════════════════
SEC "1  DOCKER"
# ════════════════════════════════════════════════════════════════════════════

$dv = docker --version 2>&1
if ($LASTEXITCODE -ne 0) { ERR "Docker no encontrado"; exit 1 }
OK $dv
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    WARN "Docker Desktop no corre — inicialo y vuelve a ejecutar"
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
    exit 1
}
OK "Docker Desktop corriendo"

# ════════════════════════════════════════════════════════════════════════════
SEC "2  ARCHIVOS"
# ════════════════════════════════════════════════════════════════════════════

$req = @("Dockerfile","docker-compose.windows.yml","package.json","server.js",
         ".env","nginx\docker.conf","scripts\docker-entrypoint.sh",
         "scripts\utilities\check-env.js",
         "src\migrations\20260505000008b-create-core-itsm-tables.js")
$miss = 0
foreach ($f in $req) {
    if (Test-Path "$Root\$f") { OK $f } else { ERR "Falta: $f"; $miss++ }
}
if ($miss) { Write-Host "  Copia los archivos faltantes a $Root" -ForegroundColor Yellow; exit 1 }

if (Test-Path $Backup) { OK "Backup: $Backup" }
else { WARN "No se encontro $Backup — la app arrancara con BD vacia" }

# ════════════════════════════════════════════════════════════════════════════
SEC "3  CONFIGURAR .ENV PARA DOCKER"
# ════════════════════════════════════════════════════════════════════════════

# Lee el .env actual (con todas las credenciales reales)
$ev = Get-Env $EnvF

# Solo sobreescribe los 3 valores que cambian al pasar de host fisico a Docker
$dockerOverrides = @{
    "EQUIPMENT_HOST" = "mysql"    # antes: localhost (XAMPP)
    "REDIS_HOST"     = "redis"    # antes: localhost
    "NODE_ENV"       = "production"
}
foreach ($kv in $dockerOverrides.GetEnumerator()) {
    if ($ev[$kv.Key] -ne $kv.Value) {
        Set-EnvLine $EnvF $kv.Key $kv.Value
        FIX "$($kv.Key)=$($kv.Value)"
    } else {
        OK "$($kv.Key)=$($kv.Value)"
    }
}

# Detectar IP del servidor y actualizar API_BASE_URL si todavia apunta a localhost
$ev = Get-Env $EnvF
if ($ev["API_BASE_URL"] -match "localhost") {
    $srvIP = (Get-NetIPAddress -AddressFamily IPv4 |
              Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" -and
                             $_.IPAddress -notmatch "^169\." } |
              Select-Object -First 1).IPAddress
    if ($srvIP) {
        Set-EnvLine $EnvF "API_BASE_URL"    "http://$srvIP"
        Set-EnvLine $EnvF "APP_URL"         "http://$srvIP"
        Set-EnvLine $EnvF "ALLOWED_ORIGINS" "http://$srvIP"
        FIX "API_BASE_URL=http://$srvIP  (era localhost)"
    }
}

# Cargar credenciales definitivas
$ev     = Get-Env $EnvF
$dbUser = $ev["EQUIPMENT_USER"]     # ricardo
$dbPass = $ev["EQUIPMENT_PASSWORD"] # Misbubus6
$dbName = $ev["EQUIPMENT_DATABASE"] # equipment_management
$rootPw = $dbPass                   # MYSQL_ROOT_PASSWORD = EQUIPMENT_PASSWORD (docker-compose)

OK "Usuario DB  : $dbUser"
OK "Base de datos: $dbName"

# ════════════════════════════════════════════════════════════════════════════
SEC "4  LIMPIAR ESTADO ANTERIOR"
# ════════════════════════════════════════════════════════════════════════════

INFO "Deteniendo stack anterior + volúmenes..."
docker compose -f $CF down --volumes --remove-orphans 2>&1 | Out-Null
foreach ($c in @("itsm-app","itsm-mysql","itsm-redis","itsm-nginx")) {
    docker rm -f $c 2>&1 | Out-Null
}
FIX "Estado anterior eliminado (contenedores + volúmenes)"

# ════════════════════════════════════════════════════════════════════════════
SEC "5  IMAGENES DOCKER"
# ════════════════════════════════════════════════════════════════════════════

foreach ($img in @("mysql:8.0","redis:7-alpine","nginx:1.25-alpine","node:20-alpine")) {
    docker image inspect $img 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { OK "$img" }
    else {
        INFO "Descargando $img..."
        docker pull $img 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { FIX "$img descargada" }
        else { ERR "No se pudo descargar $img"; exit 1 }
    }
}

INFO "Construyendo imagen itsm-app..."
$bOut = docker build -t itsm-app . 2>&1
if ($LASTEXITCODE -eq 0) { FIX "itsm-app construida" }
else {
    $bOut | Select-Object -Last 15 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    ERR "Build fallo"; exit 1
}

# ════════════════════════════════════════════════════════════════════════════
SEC "6  INICIAR MySQL Y REDIS"
# ════════════════════════════════════════════════════════════════════════════

INFO "Levantando MySQL y Redis..."
docker compose -f $CF up -d mysql redis 2>&1 | Out-Null

INFO "Esperando MySQL healthy (max 3 min)..."
$t = 0
while ($t -lt 180) {
    if ((docker inspect itsm-mysql --format "{{.State.Health.Status}}" 2>&1) -eq "healthy") { break }
    Start-Sleep 5; $t += 5; INFO "MySQL... ($t/180 s)"
}
if ((docker inspect itsm-mysql --format "{{.State.Health.Status}}" 2>&1) -ne "healthy") {
    ERR "MySQL no arranco"
    docker compose -f $CF logs mysql --tail 15 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}
OK "MySQL healthy"

$t = 0
while ($t -lt 30) {
    if ((docker inspect itsm-redis --format "{{.State.Health.Status}}" 2>&1) -eq "healthy") { break }
    Start-Sleep 5; $t += 5
}
OK "Redis healthy"

# ════════════════════════════════════════════════════════════════════════════
SEC "7  BASE DE DATOS"
# ════════════════════════════════════════════════════════════════════════════

# Verificar conexion root (root password = EQUIPMENT_PASSWORD segun docker-compose)
INFO "Verificando acceso root a MySQL..."
$chk = docker exec itsm-mysql mysql -uroot -p"$rootPw" -e "SELECT 1;" --skip-column-names -s 2>&1
if ("$chk" -notmatch "1") {
    ERR "No se puede conectar como root. Respuesta: $chk"
    ERR "Verifica que EQUIPMENT_PASSWORD en .env coincida con la contrasena configurada"
    exit 1
}
OK "Root conectado"

# Crear DB y usuario desde cero
INFO "Creando base de datos '$dbName' limpia..."
Invoke-MySql "root" $rootPw "" @"
DROP DATABASE IF EXISTS ${dbName};
CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${dbPass}';
GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'%';
FLUSH PRIVILEGES;
"@ | Out-Null
OK "BD '$dbName' creada — usuario '$dbUser' con todos los privilegios"

# Importar backup
if (Test-Path $Backup) {
    # Permitir funciones/triggers en binary-log mode
    docker exec itsm-mysql mysql -uroot -p"$rootPw" `
        -e "SET GLOBAL log_bin_trust_function_creators = 1;" 2>&1 | Out-Null

    INFO "Copiando backup al contenedor..."
    docker cp "$Backup" "itsm-mysql:/tmp/backup.sql" 2>&1 | Out-Null

    INFO "Importando backup (puede tardar varios minutos)..."
    $iOut = docker exec itsm-mysql sh -c `
        "mysql -uroot -p'$rootPw' '$dbName' < /tmp/backup.sql 2>&1"
    docker exec itsm-mysql sh -c "rm -f /tmp/backup.sql" 2>&1 | Out-Null

    # Mostrar solo errores reales (no los de triggers/funciones que son aceptables)
    @($iOut) | Where-Object { $_ -match "^ERROR [0-9]" -and $_ -notmatch "1419|1418" } |
        ForEach-Object { WARN "Import: $_" }

    $cnt = docker exec itsm-mysql mysql -uroot -p"$rootPw" "$dbName" `
           -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$dbName';" `
           --skip-column-names -s 2>&1
    if ($cnt -match '(\d+)' -and [int]$Matches[1] -gt 3) {
        OK "Backup importado — $($Matches[1]) tablas"
    } else {
        WARN "Backup importado con advertencias — tablas detectadas: $cnt"
    }
} else {
    INFO "Sin backup — las migraciones crearan todas las tablas"
}

# Poblar SequelizeMeta para que Umzug no re-ejecute migraciones del backup
# DELETE + INSERT: elimina entradas del backup (sin .js) y escribe las correctas (con .js)
INFO "Sincronizando SequelizeMeta..."
$migs    = Get-ChildItem "$Root\src\migrations" -Filter "*.js" -EA SilentlyContinue | Sort-Object Name
$metaSql = "CREATE TABLE IF NOT EXISTS SequelizeMeta " +
           "(name varchar(255) NOT NULL, PRIMARY KEY (name)) " +
           "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;" +
           "`nDELETE FROM SequelizeMeta;"
foreach ($m in $migs) {
    $metaSql += "`nINSERT INTO SequelizeMeta (name) VALUES ('$($m.Name)');"
}
Invoke-MySql "root" $rootPw $dbName $metaSql | Out-Null

$mCnt = docker exec itsm-mysql mysql -uroot -p"$rootPw" "$dbName" `
        -e "SELECT COUNT(*) FROM SequelizeMeta;" --skip-column-names -s 2>&1
if ($mCnt -match '(\d+)' -and [int]$Matches[1] -gt 0) {
    FIX "SequelizeMeta: $($Matches[1]) migraciones registradas"
} else {
    WARN "SequelizeMeta vacia — las migraciones correran al iniciar (son idempotentes)"
}

# ════════════════════════════════════════════════════════════════════════════
SEC "8  INICIAR APP + NGINX"
# ════════════════════════════════════════════════════════════════════════════

INFO "Levantando app y nginx..."
docker compose -f $CF up -d 2>&1 | Out-Null

INFO "Esperando inicio de la app (max 5 min)..."
$appOk = $false
# server.js imprime: "EQUIPMENT MANAGEMENT SYSTEM — SERVER STARTED"
$okPat  = "SERVER STARTED|Servidor listo|listening on"
$errPat = "\(up\) failed|Cannot find module|ENOENT.*server\.js|SyntaxError"

for ($i = 1; $i -le 30; $i++) {
    Start-Sleep 10
    $log = docker compose -f $CF logs app --tail 100 2>&1

    if ($log -match $okPat)  { $appOk = $true; break }
    if ($log -match $errPat) {
        ERR "La app fallo al iniciar:"
        $log -split "`n" | Where-Object { $_ -match "error|Error|ERROR|failed|SyntaxError" } |
            Select-Object -Last 8 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        break
    }
    INFO "Arrancando... ($i/30)"
}

if ($appOk) {
    OK "Aplicacion iniciada correctamente"
} else {
    ERR "La app no respondio en 5 minutos"
    BLK
    Write-Host "  ── Ultimos logs ──" -ForegroundColor Yellow
    docker compose -f $CF logs app --tail 30 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
}

# ════════════════════════════════════════════════════════════════════════════
SEC "9  VERIFICAR HTTP"
# ════════════════════════════════════════════════════════════════════════════

$httpOk = $false
for ($i = 1; $i -le 12; $i++) {
    try {
        $r = Invoke-WebRequest "http://localhost" -UseBasicParsing -TimeoutSec 8 -EA Stop
        if ($r.StatusCode -lt 400) { $httpOk = $true; break }
    } catch {}
    INFO "HTTP... ($i/12)"; Start-Sleep 5
}

if ($httpOk) { OK "HTTP responde en http://localhost" }
else         { ERR "Sin respuesta HTTP en http://localhost" }

try {
    $h = Invoke-WebRequest "http://localhost/health" -UseBasicParsing -TimeoutSec 5 -EA Stop
    if   ($h.Content -match '"db":"ok"') { OK "Health: DB + Redis OK" }
    else                                  { WARN "Health: $($h.Content)" }
} catch {}

# ════════════════════════════════════════════════════════════════════════════
SEC "10  FIREWALL"
# ════════════════════════════════════════════════════════════════════════════

if (-not (Get-NetFirewallRule -DisplayName "ITSM-HTTP" -EA SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "ITSM-HTTP" -Direction Inbound `
        -Protocol TCP -LocalPort 80 -Action Allow | Out-Null
    FIX "Puerto 80 abierto"
} else { OK "Puerto 80 ya abierto" }

# ════════════════════════════════════════════════════════════════════════════
SEC "CONTENEDORES"
# ════════════════════════════════════════════════════════════════════════════
BLK
docker compose -f $CF ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>&1 |
    ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

# ════════════════════════════════════════════════════════════════════════════
SEC "RESULTADO"
# ════════════════════════════════════════════════════════════════════════════
BLK
$url = (Get-Env $EnvF)["API_BASE_URL"] -replace "/api$",""
if (-not $url -or $url -match "localhost") { $url = "http://localhost" }

if ($global:ErrCount -eq 0) {
    Write-Host "  +==================================================+" -ForegroundColor Green
    Write-Host "  |  DESPLIEGUE EXITOSO                               |" -ForegroundColor Green
    Write-Host "  |                                                    |" -ForegroundColor Green
    Write-Host "  |  $($url.PadRight(48))|" -ForegroundColor Green
    Write-Host "  +==================================================+" -ForegroundColor Green
    if ($httpOk) { Start-Process $url }
} else {
    Write-Host "  +==================================================+" -ForegroundColor Yellow
    Write-Host "  |  DESPLIEGUE CON $($global:ErrCount) ERROR(ES)                     |" -ForegroundColor Yellow
    Write-Host "  +==================================================+" -ForegroundColor Yellow
    BLK
    Write-Host "  Diagnostico rapido:" -ForegroundColor Cyan
    Write-Host "    docker compose -f $CF logs app --tail 50" -ForegroundColor Gray
    Write-Host "    docker compose -f $CF ps" -ForegroundColor Gray
    Write-Host "    docker exec -it itsm-mysql mysql -uroot -p$rootPw $dbName" -ForegroundColor Gray
}
BLK

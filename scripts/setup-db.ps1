#Requires -RunAsAdministrator
<#
.SYNOPSIS  Valida y configura la BD para el equipo de produccion (MySQL Server)
.NOTES     Ejecutar: powershell -ExecutionPolicy Bypass -File C:\itsm\scripts\setup-db.ps1
#>

$ErrorActionPreference = "SilentlyContinue"

function OK  ($m) { Write-Host "  OK  $m" -ForegroundColor Green }
function ERR ($m) { Write-Host "  ERR $m" -ForegroundColor Red }
function FIX ($m) { Write-Host "  FIX $m" -ForegroundColor Magenta }
function INF ($m) { Write-Host "      $m" -ForegroundColor Cyan }

$Root = if ($PSScriptRoot -match '[\\/]scripts$') { Split-Path -Parent $PSScriptRoot } else { $PSScriptRoot }
$EnvF = "$Root\.env"

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

$ev     = Get-Env $EnvF
$dbHost = if ($ev["EQUIPMENT_HOST"]) { $ev["EQUIPMENT_HOST"] } else { "localhost" }
$dbUser = if ($ev["EQUIPMENT_USER"]) { $ev["EQUIPMENT_USER"] } else { "ricardo" }
$dbPass = if ($ev["EQUIPMENT_PASSWORD"]) { $ev["EQUIPMENT_PASSWORD"] } else { "Misbubus6" }
$dbName = if ($ev["EQUIPMENT_DATABASE"]) { $ev["EQUIPMENT_DATABASE"] } else { "equipment_management" }
$dbPort = if ($ev["EQUIPMENT_PORT"]) { $ev["EQUIPMENT_PORT"] } else { "3306" }

Write-Host ""
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "   ITSM — Setup BD en MySQL Server              " -ForegroundColor White
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor DarkCyan
INF "Host: $dbHost | DB: $dbName | User: $dbUser"
Write-Host ""

# ── buscar mysql.exe ──────────────────────────────────────────────────────────
$mysqlExe = $null
$candidates = @(
    $(try { (Get-Command mysql -ErrorAction Stop).Source } catch { $null }),
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe",
    "C:\Program Files\MySQL\MySQL Server 5.7\bin\mysql.exe",
    "C:\xampp\mysql\bin\mysql.exe"
)
foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $mysqlExe = $c; break }
}

if (-not $mysqlExe) {
    ERR "No se encontro mysql.exe — agrega MySQL\bin al PATH o instala MySQL Server"
    exit 1
}
OK "MySQL client: $mysqlExe"

# ── helper: ejecutar SQL como root ───────────────────────────────────────────
function Invoke-SQL ([string]$sql, [string]$db = "") {
    $args_ = @("-h", $dbHost, "-P", $dbPort, "-u", "root", "--password=$dbPass")
    if ($db) { $args_ += $db }
    $args_ += @("-e", $sql, "--skip-column-names", "-s")
    return (& $mysqlExe @args_ 2>&1)
}

# ── 1. conexion root ──────────────────────────────────────────────────────────
INF "Verificando conexion MySQL..."
$ping = Invoke-SQL "SELECT 1;"
if ("$ping" -notmatch "1") {
    ERR "No se puede conectar a MySQL. Verifica que el servicio este activo y que la contrasena root sea la misma que EQUIPMENT_PASSWORD en .env"
    INF "Intento con usuario '$dbUser' en vez de root..."
    $args_ = @("-h", $dbHost, "-P", $dbPort, "-u", $dbUser, "--password=$dbPass", "-e", "SELECT 1;", "-s")
    $ping2 = (& $mysqlExe @args_ 2>&1)
    if ("$ping2" -notmatch "1") {
        ERR "Tampoco funciona con '$dbUser'. Revisa credenciales en .env"
        exit 1
    }
    OK "Conexion OK con usuario '$dbUser' (sin acceso root)"
} else {
    OK "Conexion root OK"

    # ── 2. crear BD y usuario si no existen ──────────────────────────────────
    INF "Verificando base de datos '$dbName'..."
    $dbExists = Invoke-SQL "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$dbName';"
    if ("$dbExists" -notmatch $dbName) {
        Invoke-SQL "CREATE DATABASE $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" | Out-Null
        FIX "Base de datos '$dbName' creada"
    } else {
        OK "BD '$dbName' existe"
    }

    Invoke-SQL "CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '$dbPass';
                CREATE USER IF NOT EXISTS '${dbUser}'@'%'         IDENTIFIED BY '$dbPass';
                GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'localhost';
                GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'%';
                FLUSH PRIVILEGES;
                SET GLOBAL log_bin_trust_function_creators=1;" | Out-Null
    OK "Usuario '$dbUser' con permisos OK"
}

# ── 3. verificar tablas clave ─────────────────────────────────────────────────
INF "Verificando tablas..."
$args_ = @("-h", $dbHost, "-P", $dbPort, "-u", $dbUser, "--password=$dbPass", $dbName,
           "-e", "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$dbName';",
           "--skip-column-names", "-s")
$tableCnt = (& $mysqlExe @args_ 2>&1)

$hasUsers = (& $mysqlExe @("-h",$dbHost,"-P",$dbPort,"-u",$dbUser,"--password=$dbPass",$dbName,
    "-e","SHOW TABLES LIKE 'users';","--skip-column-names","-s") 2>&1)

if ($tableCnt -match '(\d+)' -and [int]$Matches[1] -gt 5) {
    OK "$($Matches[1]) tablas encontradas"
} else {
    FIX "BD vacia o incompleta — corriendo migraciones..."
}

if ("$hasUsers" -notmatch "users") {
    FIX "Tabla 'users' faltante — corriendo migraciones..."
}

# ── 4. correr migraciones ─────────────────────────────────────────────────────
INF "Ejecutando migraciones (puede tardar 30s)..."
$migOut = & node "$Root\src\config\migrator.js" up 2>&1
$migErrors = @($migOut) | Where-Object { $_ -match "failed|Error:" -and $_ -notmatch "debug" }

if ($migErrors.Count -eq 0) {
    OK "Migraciones completadas sin errores"
} else {
    $migErrors | ForEach-Object { ERR $_ }
    ERR "Algunas migraciones fallaron — revisa arriba"
}

# ── 5. verificar/crear usuario admin ─────────────────────────────────────────
INF "Verificando usuario admin..."
$adminExists = (& $mysqlExe @("-h",$dbHost,"-P",$dbPort,"-u",$dbUser,"--password=$dbPass",$dbName,
    "-e","SELECT COUNT(*) FROM users WHERE username='admin';","--skip-column-names","-s") 2>&1)

if ($adminExists -match "^1") {
    OK "Usuario admin ya existe"
} else {
    INF "Creando usuario admin (contrasena: Admin123!)..."
    $hashOut = & node -e "const b=require('bcryptjs'),u=require('uuid');console.log(b.hashSync('Admin123!',10)+'|'+u.v4())" 2>&1
    if ($hashOut -match "^(\`$2[ab]\$.+)\|(.+)$") {
        $hash = $Matches[1]; $uid = $Matches[2]
        & $mysqlExe @("-h",$dbHost,"-P",$dbPort,"-u",$dbUser,"--password=$dbPass",$dbName,
            "-e","INSERT INTO users (id,tenant_id,username,full_name,email,password_hash,role,is_active,is_verified,created_at,updated_at) VALUES ('$uid',1,'admin','Administrador','admin@integratel.pe','$hash','admin',1,1,NOW(),NOW());") 2>&1 | Out-Null
        FIX "Usuario admin creado — login: admin / Admin123!"
    } else {
        ERR "No se pudo generar hash (bcryptjs o uuid no instalados en $Root)"
    }
}

# ── 6. resumen ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "   RESULTADO                                     " -ForegroundColor White
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor DarkCyan
$finalCnt = (& $mysqlExe @("-h",$dbHost,"-P",$dbPort,"-u",$dbUser,"--password=$dbPass",$dbName,
    "-e","SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$dbName';","--skip-column-names","-s") 2>&1)
OK "Tablas en BD: $finalCnt"
INF "Reinicia el servidor Node para que tome los cambios"
Write-Host ""

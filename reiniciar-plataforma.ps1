# Reinicia la plataforma de forma segura:
# 1. Mata cualquier proceso nodemon / npm run dev que compita con PM2
# 2. Libera el puerto 3443 si sigue ocupado por un proceso huerfano
# 3. Reinicia equipment-app y meshcentral via PM2
# Ejecutar con: powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\project-root - copia\reiniciar-plataforma.ps1"

$ErrorActionPreference = "SilentlyContinue"
$logFile = "C:\project-root - copia\logs\reinicio.log"
$null = New-Item -ItemType Directory -Force (Split-Path $logFile)

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $logFile -Value $line
}

Log "=== Iniciando reinicio seguro ==="

# 1. Matar nodemon y npm run dev (nunca deben correr en produccion)
$killed = @()
Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and (
        $_.CommandLine -match "nodemon" -or
        $_.CommandLine -match "npm.*run.*dev"
    )
} | ForEach-Object {
    $killed += $_.ProcessId
    $_.Terminate() | Out-Null
    Log "Eliminado proceso competidor PID $($_.ProcessId): $($_.CommandLine)"
}

# Matar procesos npm que lancen dev
Get-WmiObject Win32_Process | Where-Object {
    $_.Name -match "^(npm|cmd)\.exe$" -and $_.CommandLine -match "run dev"
} | ForEach-Object {
    $_.Terminate() | Out-Null
    Log "Eliminado npm/cmd PID $($_.ProcessId)"
}

if ($killed.Count -gt 0) {
    Log "Eliminados $($killed.Count) proceso(s) competidor(es). Esperando liberacion de puerto..."
    Start-Sleep -Seconds 3
} else {
    Log "Sin procesos competidores activos"
}

# 2. Verificar y liberar puerto 3443 si hay proceso huerfano (distinto al PM2)
$pm2PID = (Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -match "ProcessContainerFork"
} | Select-Object -First 1).ProcessId

$portProc = netstat -ano | Select-String ":3443 " | ForEach-Object {
    if ($_ -match "\s+(\d+)$") { [int]$Matches[1] }
} | Select-Object -Unique

foreach ($pid in $portProc) {
    if ($pid -ne $pm2PID -and $pid -gt 4) {
        Log "Puerto 3443 ocupado por PID $pid (no es PM2) - eliminando"
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

# 3. Reiniciar via PM2
$pm2 = "$env:APPDATA\npm\pm2.ps1"
if (-not (Test-Path $pm2)) { $pm2 = (Get-Command pm2 -ErrorAction SilentlyContinue).Source }

Log "Reiniciando equipment-app via PM2..."
& powershell -ExecutionPolicy Bypass -File $pm2 restart equipment-app 2>&1 | ForEach-Object { Log $_ }

Log "Reiniciando meshcentral via PM2..."
& powershell -ExecutionPolicy Bypass -File $pm2 restart meshcentral 2>&1 | ForEach-Object { Log $_ }

Log "=== Reinicio completado ==="

# Ejecutado por el Scheduled Task al iniciar sesion (sin ventana visible)
# Mata procesos competidores y hace pm2 resurrect
$ErrorActionPreference = "SilentlyContinue"
$logFile = "C:\project-root - copia\logs\startup.log"
$null = New-Item -ItemType Directory -Force (Split-Path $logFile)

function Log($msg) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
}

Log "=== Startup al iniciar sesion ==="

# Esperar a que el sistema termine de cargar
Start-Sleep -Seconds 5

# Matar cualquier nodemon o npm run dev que haya quedado del inicio
Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and ($_.CommandLine -match "nodemon" -or $_.CommandLine -match "npm.*run.*dev")
} | ForEach-Object { $_.Terminate() | Out-Null; Log "Eliminado: PID $($_.ProcessId)" }

Get-WmiObject Win32_Process | Where-Object {
    $_.Name -match "^(npm|cmd)\.exe$" -and $_.CommandLine -match "run dev"
} | ForEach-Object { $_.Terminate() | Out-Null; Log "Eliminado npm PID $($_.ProcessId)" }

# Resurrect PM2 (retoma el proceso guardado con pm2 save)
$pm2 = "$env:APPDATA\npm\pm2.ps1"
Log "Ejecutando pm2 resurrect..."
& powershell -ExecutionPolicy Bypass -File $pm2 resurrect 2>&1 | ForEach-Object { Log $_ }

Log "=== Startup completado ==="

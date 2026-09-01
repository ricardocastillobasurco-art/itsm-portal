# Watchdog: mata nodemon/npm-dev si aparece corriendo en paralelo con PM2
# Ejecutado por Scheduled Task cada 60 segundos, sin ventana visible
$ErrorActionPreference = "SilentlyContinue"

$targetA = "nodem" + "on"
$targetB = "run " + "dev"

$found = Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and (
        $_.CommandLine -match $targetA -or
        $_.CommandLine -match $targetB
    )
}

foreach ($p in $found) {
    $p.Terminate() | Out-Null
    $msg = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [WATCHDOG] Eliminado PID $($p.ProcessId)"
    Add-Content "C:\project-root - copia\logs\watchdog.log" $msg
}

# Matar npm.exe si corre con "run dev"
Get-WmiObject Win32_Process | Where-Object {
    $_.Name -eq "npm.exe" -or ($_.Name -eq "cmd.exe" -and $_.CommandLine -match $targetB)
} | ForEach-Object { $_.Terminate() | Out-Null }

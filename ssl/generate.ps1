# Genera certificado SSL autofirmado para Node.js (sin instalar OpenSSL)
# Uso: powershell -ExecutionPolicy Bypass -File ssl\generate.ps1

$ErrorActionPreference = 'Stop'
$IP = "10.4.117.27"

# ── 1. Crear carpeta ssl si no existe ────────────────────────────────────────
$sslDir = Split-Path $MyInvocation.MyCommand.Path
Write-Host "Directorio SSL: $sslDir"

# ── 2. Crear certificado autofirmado en el store de Windows ──────────────────
Write-Host "Generando certificado para $IP ..."
$cert = New-SelfSignedCertificate `
    -DnsName $IP, "localhost" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(3) `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -KeyExportPolicy Exportable `
    -FriendlyName "ITSM Portal SSL"

Write-Host "  Thumbprint: $($cert.Thumbprint)"

# ── 3. Exportar a PFX temporal ───────────────────────────────────────────────
$pfxPass  = ConvertTo-SecureString "ITSMtemp2024!" -Force -AsPlainText
$pfxPath  = Join-Path $sslDir "portal_temp.pfx"
Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
    -FilePath $pfxPath -Password $pfxPass | Out-Null
Write-Host "  PFX exportado: $pfxPath"

# ── 4. Localizar OpenSSL (Git lo trae incluido) ───────────────────────────────
$candidates = @(
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files (x86)\Git\usr\bin\openssl.exe",
    "C:\Git\usr\bin\openssl.exe"
)
$osslPath = $null
# Primero buscar en PATH
try { $osslPath = (Get-Command openssl -ErrorAction Stop).Source } catch {}
# Luego candidatos conocidos
if (-not $osslPath) {
    foreach ($c in $candidates) {
        if (Test-Path $c) { $osslPath = $c; break }
    }
}
if (-not $osslPath) {
    Write-Error @"
OpenSSL no encontrado.
Opciones:
  A) Instala Git for Windows (https://git-scm.com) — incluye OpenSSL
  B) Descarga OpenSSL standalone: https://slproweb.com/products/Win32OpenSSL.html
  C) Agrega openssl.exe al PATH y vuelve a ejecutar este script
"@
    exit 1
}
Write-Host "  OpenSSL: $osslPath"

# ── 5. Convertir PFX → PEM ────────────────────────────────────────────────────
$keyPath  = Join-Path $sslDir "portal.key"
$crtPath  = Join-Path $sslDir "portal.crt"
$pass     = "ITSMtemp2024!"

Write-Host "Extrayendo clave privada..."
& $osslPath pkcs12 -in $pfxPath -nocerts -nodes -out $keyPath -passin "pass:$pass" 2>&1 | Out-Null

Write-Host "Extrayendo certificado..."
& $osslPath pkcs12 -in $pfxPath -nokeys -clcerts -out $crtPath -passin "pass:$pass" 2>&1 | Out-Null

# ── 6. Limpiar PFX temporal ───────────────────────────────────────────────────
Remove-Item $pfxPath -Force

# ── 7. Verificar ─────────────────────────────────────────────────────────────
if ((Test-Path $keyPath) -and (Test-Path $crtPath)) {
    Write-Host ""
    Write-Host "========================================"
    Write-Host " SSL generado exitosamente"
    Write-Host "========================================"
    Write-Host "  Llave:  $keyPath"
    Write-Host "  Cert:   $crtPath"
    Write-Host ""
    Write-Host "Proximos pasos:"
    Write-Host "  1. Editar .env: PORT=443  APP_URL=https://$IP"
    Write-Host "  2. Agregar en Azure AD redirect URI:"
    Write-Host "     https://$IP/api/auth/microsoft/callback"
    Write-Host "  3. Reiniciar el servidor (node server.js)"
    Write-Host ""
} else {
    Write-Error "Fallo al generar archivos PEM. Revisa los errores de OpenSSL arriba."
}
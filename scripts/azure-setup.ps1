# ============================================================
# azure-setup.ps1 — Crea todos los recursos de Azure para ITSM
# Uso: .\scripts\azure-setup.ps1
# Requiere: az cli instalado y autenticado (az login)
# ============================================================

# ── CONFIGURACION — edita estos valores ─────────────────────
$APP_NAME   = "itsm-portal-test"        # nombre global unico en .azurewebsites.net
$MYSQL_NAME = "mysql-itsm-test"         # nombre global unico
$DB_USER    = "itsm_admin"
$DB_PASS    = "ITS-M@2026!Test"         # min 8 chars, mayus+minus+numero+especial
$DB_NAME    = "equipment_management"
$RG         = "rg-itsm-test"
$LOC        = "eastus"                  # o "brazilsouth" (menor latencia desde PE)
# ────────────────────────────────────────────────────────────

Write-Host "`n[1/6] Login y suscripcion activa" -ForegroundColor Cyan
az account show --output table

Write-Host "`n[2/6] Resource Group: $RG" -ForegroundColor Cyan
az group create --name $RG --location $LOC --output none

Write-Host "`n[3/6] App Service Plan F1 (gratis)" -ForegroundColor Cyan
az appservice plan create `
  --name "plan-$APP_NAME" `
  --resource-group $RG `
  --sku F1 `
  --is-linux `
  --output none

Write-Host "`n[4/6] Web App Node 20: $APP_NAME" -ForegroundColor Cyan
az webapp create `
  --resource-group $RG `
  --plan "plan-$APP_NAME" `
  --name $APP_NAME `
  --runtime "NODE:20-lts" `
  --output none

# Habilitar WebSockets (necesario para Socket.io)
az webapp config set `
  --resource-group $RG `
  --name $APP_NAME `
  --web-sockets-enabled true `
  --output none

Write-Host "`n[5/6] MySQL Flexible Server Burstable B1ms (gratis con cuenta free)" -ForegroundColor Cyan
az mysql flexible-server create `
  --resource-group $RG `
  --name $MYSQL_NAME `
  --location $LOC `
  --admin-user $DB_USER `
  --admin-password $DB_PASS `
  --sku-name Standard_B1ms `
  --tier Burstable `
  --version 8.0 `
  --storage-size 20 `
  --yes `
  --output none

az mysql flexible-server db create `
  --resource-group $RG `
  --server-name $MYSQL_NAME `
  --database-name $DB_NAME `
  --output none

# Permitir que App Service se conecte al MySQL (Azure services)
az mysql flexible-server firewall-rule create `
  --resource-group $RG `
  --name $MYSQL_NAME `
  --rule-name AllowAzureServices `
  --start-ip-address 0.0.0.0 `
  --end-ip-address 0.0.0.0 `
  --output none

Write-Host "`n[6/6] Variables de entorno en App Service" -ForegroundColor Cyan
$MYSQL_HOST = "$MYSQL_NAME.mysql.database.azure.com"
$APP_URL    = "https://$APP_NAME.azurewebsites.net"

az webapp config appsettings set `
  --resource-group $RG --name $APP_NAME `
  --settings `
    NODE_ENV=production `
    PORT=8080 `
    APP_URL=$APP_URL `
    ALLOWED_ORIGINS=$APP_URL `
    API_BASE_URL="$APP_URL/api" `
    EQUIPMENT_HOST=$MYSQL_HOST `
    EQUIPMENT_USER=$DB_USER `
    EQUIPMENT_PASSWORD=$DB_PASS `
    EQUIPMENT_DATABASE=$DB_NAME `
    EQUIPMENT_PORT=3306 `
    DB_SSL=true `
    DB_POOL_MAX=5 `
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") `
    JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") `
    JWT_EXPIRE=999m `
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") `
    RATE_LIMIT_ENABLED=false `
    SUPERADMIN_EMAIL=superadmin@plataforma.local `
    SUPERADMIN_PASSWORD="SuperAdmin@2026!" `
    SUPERADMIN_USERNAME=superadmin `
  --output none

Write-Host "`n[PENDIENTE — añade manualmente estas variables en Azure Portal]" -ForegroundColor Yellow
Write-Host "  JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN"
Write-Host "  SMTP_HOST, SMTP_USER, SMTP_PASS"
Write-Host "  GROQ_API_KEY"
Write-Host "  MS_CLIENT_ID, MS_TENANT_ID, MS_CLIENT_SECRET  (opcional — solo para SSO)"

Write-Host "`n== Publish Profile para GitHub Actions ==" -ForegroundColor Cyan
Write-Host "Copialo en GitHub → Settings → Secrets → AZURE_WEBAPP_PUBLISH_PROFILE`n"
az webapp deployment list-publishing-profiles `
  --resource-group $RG --name $APP_NAME --xml

Write-Host "`n== LISTO ==" -ForegroundColor Green
Write-Host "URL: $APP_URL"
Write-Host "MySQL host: $MYSQL_HOST"
Write-Host "Usuario MySQL: $DB_USER / $DB_PASS"
Write-Host "`nProximo paso — corre las migraciones desde local:"
Write-Host "  `$env:EQUIPMENT_HOST='$MYSQL_HOST'; `$env:EQUIPMENT_USER='$DB_USER'; `$env:EQUIPMENT_PASSWORD='$DB_PASS'; npm run migrate"

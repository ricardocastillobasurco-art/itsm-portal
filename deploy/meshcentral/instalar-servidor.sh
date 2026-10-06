#!/bin/bash
# Instala MeshCentral en un servidor Ubuntu 22.04/24.04 nuevo, de forma segura.
#
#   sudo bash instalar-servidor.sh
#
# Qué hace:
#   1. Verifica que el dominio apunte a este servidor (necesario para el certificado).
#   2. Actualiza el sistema y activa las actualizaciones de seguridad automáticas.
#   3. Firewall: solo SSH, 80 y 443. Protección contra fuerza bruta en SSH (fail2ban).
#   4. Instala Docker y construye MeshCentral con sus complementos.
#   5. Crea TU cuenta de administrador y la cuenta de servicio del portal ANTES de
#      abrir el servidor (así nadie más puede crear la primera cuenta).
#   6. Inicia MeshCentral con certificado automático (Let's Encrypt).
# Se puede volver a ejecutar: no borra datos ni cuentas existentes.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta con sudo: sudo bash $0"; exit 1; fi
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
for f in docker-compose.yml Dockerfile config.json; do
  [ -f "$f" ] || { echo "Falta $f en $DIR (sube la carpeta deploy/meshcentral completa)"; exit 1; }
done

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
rand() { openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }

# ── Datos ────────────────────────────────────────────────────────────────────
if [ ! -f meshcentral-data/config.json ]; then
  read -rp "Dominio del servidor (ej. rmm.tumarca.com): " DOMAIN
  read -rp "Tu correo (avisos del certificado y cuenta de administrador): " EMAIL
  read -rp "Tu usuario de administrador en MeshCentral [admin]: " ADMIN_USER
  ADMIN_USER=${ADMIN_USER:-admin}
  DOMAIN=$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | tr -d ' ')
  [[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || { echo "Dominio inválido: $DOMAIN"; exit 1; }
  [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "Correo inválido: $EMAIL"; exit 1; }
  [[ "$ADMIN_USER" =~ ^[A-Za-z0-9._-]{3,32}$ ]] || { echo "Usuario inválido (3-32 letras, números, . _ -)"; exit 1; }
fi

say "Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q ca-certificates curl openssl dnsutils ufw fail2ban unattended-upgrades
# Parches de seguridad automáticos
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban >/dev/null

if [ -n "${DOMAIN:-}" ]; then
  say "Verificando que $DOMAIN apunte a este servidor"
  MY_IP=$(curl -fsS4 https://api.ipify.org || true)
  DNS_IP=$(dig +short A "$DOMAIN" @1.1.1.1 | tail -n1)
  if [ -z "$MY_IP" ] || [ "$MY_IP" != "$DNS_IP" ]; then
    echo "⚠️  $DOMAIN apunta a '${DNS_IP:-nada}' pero este servidor es '${MY_IP:-desconocido}'."
    echo "    Crea/corrige el registro A del dominio con la IP $MY_IP, espera unos minutos y vuelve a ejecutar."
    exit 1
  fi
fi

say "Firewall: solo SSH (22), HTTP (80) y HTTPS (443)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

if ! command -v docker >/dev/null; then
  say "Instalando Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

mkdir -p meshcentral-data meshcentral-files meshcentral-backups
FIRST_INSTALL=0
if [ ! -f meshcentral-data/config.json ]; then
  FIRST_INSTALL=1
  say "Creando la configuración"
  BACKUP_PASS=$(rand 24)
  sed -e "s/TU_SERVIDOR_RMM/$DOMAIN/g" -e "s/TU_CORREO/$EMAIL/g" -e "s/CLAVE_RESPALDOS/$BACKUP_PASS/g" \
      config.json > meshcentral-data/config.json
fi
chmod 700 meshcentral-data meshcentral-backups
chmod 600 meshcentral-data/config.json

say "Construyendo MeshCentral (unos minutos la primera vez)"
docker compose build -q

if [ "$FIRST_INSTALL" = 1 ]; then
  say "Creando las cuentas (antes de abrir el servidor)"
  ADMIN_PASS="$(rand 20)!a1"
  PORTAL_PASS="$(rand 32)"
  mc() { docker compose run --rm --no-deps --entrypoint node meshcentral meshcentral/meshcentral.js "$@"; }
  mc --createaccount "$ADMIN_USER" --pass "$ADMIN_PASS" --email "$EMAIL" >/dev/null
  mc --adminaccount "$ADMIN_USER" >/dev/null
  mc --createaccount portal --pass "$PORTAL_PASS" --email "portal@$DOMAIN" >/dev/null
  mc --adminaccount portal >/dev/null
  # Llave para abrir las sesiones remotas desde el portal sin pedir usuario
  LOGIN_KEY=$(mc --logintokenkey | tail -n1 | tr -cd '0-9a-f')
  [[ "$LOGIN_KEY" =~ ^[0-9a-f]{160}$ ]] || { echo "No se pudo obtener la llave de inicio de sesión"; exit 1; }
fi

say "Iniciando MeshCentral"
docker compose up -d

echo -n "Esperando el certificado y el arranque"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "https://$(grep -o '"cert": *"[^"]*"' meshcentral-data/config.json | cut -d'"' -f4)/" 2>/dev/null; then OK=1; break; fi
  echo -n "."; sleep 5
done
echo

HOST=$(grep -o '"cert": *"[^"]*"' meshcentral-data/config.json | cut -d'"' -f4)
if [ "${OK:-0}" != 1 ]; then
  echo "⚠️  Aún no responde con certificado válido. Revisa: docker compose logs --tail 50"
fi

if [ "$FIRST_INSTALL" = 1 ]; then
  cat <<EOF

════════════════════════════════════════════════════════════════════
 ✅ MeshCentral instalado:  https://$HOST

 GUARDA ESTOS DATOS EN TU GESTOR DE CONTRASEÑAS (no se vuelven a mostrar):

   Tu acceso de administrador
     Usuario:     $ADMIN_USER
     Contraseña:  $ADMIN_PASS
     → Entra y ACTIVA la verificación en dos pasos (Mi cuenta → Seguridad).

   Cuenta del portal (va en el superadmin del portal → RMM → Configuración)
     URL:         https://$HOST
     Usuario:     portal
     Contraseña:  $PORTAL_PASS
     Llave de inicio de sesión:
       $LOGIN_KEY

   Clave de los respaldos automáticos (para abrir los .zip):
     $BACKUP_PASS
════════════════════════════════════════════════════════════════════
EOF
else
  echo "✅ MeshCentral actualizado y en marcha: https://$HOST"
  echo "   (Llave de inicio de sesión: docker compose run --rm --no-deps --entrypoint node meshcentral meshcentral/meshcentral.js --logintokenkey)"
fi

#!/bin/sh
# Restaura una copia cifrada generada por .github/workflows/backup.yml
#
# Uso:
#   BACKUP_PASSPHRASE='...' DB_HOST=... DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=itsm_restaurada \
#     sh scripts/backup/restore.sh itsm-AAAAMMDD-HHMM.sql.gz.gpg
#
# Recomendación: restaurar primero en una base NUEVA (DB_NAME distinto) y revisar;
# nunca directamente sobre producción sin haber probado.
set -eu

FILE="${1:?Indica el archivo .sql.gz.gpg}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"
: "${DB_HOST:?Falta DB_HOST}" "${DB_USER:?Falta DB_USER}" "${DB_NAME:?Falta DB_NAME}"
DB_PORT="${DB_PORT:-3306}"
export MYSQL_PWD="${DB_PASSWORD:-}"

# Se descifra y verifica ANTES de tocar la base: con una contraseña incorrecta o
# un archivo dañado el script se detiene sin cargar nada.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
echo "→ Descifrando $FILE"
gpg --batch --quiet --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --decrypt -o "$TMP" "$FILE" \
  || { echo "✗ No se pudo descifrar (¿contraseña incorrecta?)"; exit 1; }
gunzip -t < "$TMP" || { echo "✗ El archivo está dañado"; exit 1; }

echo "→ Creando la base $DB_NAME (si no existe) en $DB_HOST:$DB_PORT"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

echo "→ Cargando en $DB_NAME"
gunzip -c < "$TMP" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" --default-character-set=utf8mb4 "$DB_NAME"

TABLES=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME'")
TENANTS=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -N -e "SELECT COUNT(*) FROM \`$DB_NAME\`.tenants" 2>/dev/null || echo "?")
echo "✓ Restaurada: $TABLES tablas, $TENANTS empresas"

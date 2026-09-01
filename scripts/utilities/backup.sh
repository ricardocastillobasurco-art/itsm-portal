#!/usr/bin/env bash
# scripts/utilities/backup.sh — Backup diario de la BD del ITSM
#
# Configurar como cron (crontab -e):
#   0 3 * * * /srv/itsm/scripts/utilities/backup.sh >> /var/log/itsm-backup.log 2>&1
#
# Variables esperadas (del entorno del servidor o de un .env cargado):
#   DB_USER, DB_PASS, DB_NAME, DB_HOST (default: localhost)
#   BACKUP_DIR  (default: /backups/itsm)
#   S3_BUCKET   (opcional: s3://my-bucket/itsm-backups)
#   RETENTION_DAYS (default: 30)
set -euo pipefail

DB_USER="${EQUIPMENT_USER:-root}"
DB_PASS="${EQUIPMENT_PASSWORD:-}"
DB_NAME="${EQUIPMENT_DATABASE:-equipment_management}"
DB_HOST="${EQUIPMENT_HOST:-localhost}"
DB_PORT="${EQUIPMENT_PORT:-3306}"

BACKUP_DIR="${BACKUP_DIR:-/backups/itsm}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DATE="$(date +%Y%m%d_%H%M%S)"
FILENAME="${DB_NAME}_${DATE}.sql.gz"
DEST="${BACKUP_DIR}/${FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] Iniciando backup → ${DEST}"

# Dump + compress
MYSQL_PWD="${DB_PASS}" mysqldump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --user="${DB_USER}" \
    --single-transaction \
    --routines \
    --triggers \
    "${DB_NAME}" | gzip -9 > "${DEST}"

SIZE=$(du -sh "${DEST}" | cut -f1)
echo "[$(date -Iseconds)] Backup completado: ${DEST} (${SIZE})"

# Subir a S3 si está configurado
if [[ -n "${S3_BUCKET:-}" ]]; then
    aws s3 cp "${DEST}" "${S3_BUCKET}/${FILENAME}" --storage-class STANDARD_IA
    echo "[$(date -Iseconds)] Subido a S3: ${S3_BUCKET}/${FILENAME}"
fi

# Rotación — eliminar backups antiguos
echo "[$(date -Iseconds)] Eliminando backups anteriores a ${RETENTION_DAYS} días..."
find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "[$(date -Iseconds)] Backup finalizado OK"

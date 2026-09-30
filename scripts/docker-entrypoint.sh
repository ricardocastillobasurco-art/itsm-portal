#!/bin/sh
# docker-entrypoint.sh — Startup sequence for production container
set -e

echo "[entrypoint] Validando variables de entorno..."
node scripts/utilities/check-env.js

echo "[entrypoint] Ejecutando migraciones pendientes..."
# Una migración fallida no debe tumbar todo el servicio: se registra el error y la
# app arranca igual (server.js reintenta las migraciones pendientes al iniciar).
if ! node src/config/migrator.js up; then
  echo "[entrypoint] ⚠️  ATENCIÓN: una migración falló (ver error arriba). La aplicación arranca igual."
fi

echo "[entrypoint] Iniciando aplicación..."
exec node server.js

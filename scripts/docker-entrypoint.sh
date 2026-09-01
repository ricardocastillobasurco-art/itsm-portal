#!/bin/sh
# docker-entrypoint.sh — Startup sequence for production container
set -e

echo "[entrypoint] Validando variables de entorno..."
node scripts/utilities/check-env.js

echo "[entrypoint] Ejecutando migraciones pendientes..."
node src/config/migrator.js up

echo "[entrypoint] Iniciando aplicación..."
exec node server.js

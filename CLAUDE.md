# Proyecto Backend - Guía de Contexto

## Stack
- Node.js + Express | Sequelize (ORM) | Socket.io | Bull (queues)
- Auth: Azure MSAL | Logs: Winston | Vistas: EJS/Pug
- BD: relacional (Sequelize dialects: mysql/postgres/mssql)

## Estructura clave
```
config/        → configuración DB, Azure, app
controllers/   → lógica HTTP por entidad
routes/        → definición de rutas Express
services/      → lógica de negocio reutilizable
middleware/    → auth, validación, manejo de errores
src/
  models/      → modelos Sequelize
  migrations/  → migraciones de BD
  seeders/     → datos iniciales
  queues/      → workers Bull
  jobs/        → tareas programadas
  rules/       → reglas de negocio
utils/         → helpers genéricos
views/         → plantillas (admin/agent/user/emails)
public/        → assets estáticos
uploads/       → archivos subidos por usuarios
```

## Convenciones
- Controllers: solo HTTP (req/res), delegar lógica a services
- Services: lógica de negocio pura, sin req/res
- Modelos Sequelize: definir asociaciones en el mismo archivo
- Rutas: agrupar por entidad en routes/, montar en app.js
- Errores: usar middleware centralizado, no try/catch en controllers

## Al implementar una nueva funcionalidad
1. Modelo en src/models/ (si hay nueva tabla)
2. Migración en src/migrations/
3. Service en services/
4. Controller en controllers/
5. Ruta en routes/ y montarla en app.js

## Reglas de respuesta (IMPORTANTE - ahorra tokens)
- Responde SOLO el código que cambia, nunca el archivo completo
- Sin explicaciones a menos que las pida explícitamente
- Sin confirmaciones del tipo "entendido" o "perfecto"
- Si necesitas contexto de un archivo, pídelo; no lo explores solo
- Usa diff format cuando el cambio sea menor a 20 líneas
- Una tarea a la vez, avisa cuando esté lista con: ✓ DONE

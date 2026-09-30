'use strict';

// Configuración de la plataforma (no de un cliente). Nada de nombres ni correos
// de empresas en el código: todo sale de variables de entorno o de la tabla tenants.
//
//   PLATFORM_NAME      Nombre comercial que ven los usuarios (por defecto "Portal TI")
//   SUPERADMIN_EMAILS  Correos (separados por coma) que al entrar con Microsoft
//                      reciben rol superadmin. Opcional: los roles ya asignados se conservan.
//   ADMIN_EMAILS       Ídem para rol administrador del tenant dueño.

const list = (v) => (v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

module.exports = {
  OWNER_TENANT_ID:   1,
  PLATFORM_NAME:     process.env.PLATFORM_NAME || 'Portal TI',
  SUPERADMIN_EMAILS: list(process.env.SUPERADMIN_EMAILS),
  ADMIN_EMAILS:      list(process.env.ADMIN_EMAILS),
};

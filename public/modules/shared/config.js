/**
 * ============================================================
 * MÓDULO: config.js
 * ============================================================
 * Responsabilidad: Gestión del estado global de configuración
 * de conexión con Jira (URL, credenciales, nombre de usuario).
 *
 * Expone:
 *  - CFG          → objeto de configuración mutable (singleton)
 *  - saveConfig() → valida, persiste en CFG y actualiza la UI
 *  - openConfig() → pre-rellena y muestra el modal de ajustes
 *  - testConnection() → prueba las credenciales antes de guardar
 *  - resolveMyAccountId() → resuelve el accountId del usuario actual
 * ============================================================
 */

/**
 * Objeto singleton que almacena las credenciales activas.
 * Todos los módulos que necesiten autenticarse deben leer
 * de este objeto en lugar de mantener su propia copia.
 *
 * @type {{ url: string, email: string, token: string, name: string, accountId: string }}
 */
let CFG = {
  url:       '',   // Base URL del servidor Jira (sin slash final)
  email:     '',   // Correo del agente autenticado
  token:     '',   // API token de Jira
  name:      '',   // Nombre para mostrar (opcional)
  accountId: '',   // accountId de Jira (resuelto automáticamente)
};

/**
 * Lee los campos del formulario de configuración, valida que los
 * obligatorios no estén vacíos, actualiza el sidebar con los datos
 * del usuario y dispara la carga inicial de datos.
 *
 * Efectos secundarios:
 *  - Oculta el overlay de configuración
 *  - Actualiza avatar/email/nombre en el sidebar
 *  - Llama a loadMisAsig(), loadSinAsig() y resolveMyAccountId()
 */
function saveConfig() {
  CFG.url   = document.getElementById('cfg_url').value.trim().replace(/\/$/, '');
  CFG.email = document.getElementById('cfg_email').value.trim();
  CFG.token = document.getElementById('cfg_token').value.trim();
  CFG.name  = document.getElementById('cfg_name').value.trim();

  if (!CFG.url || !CFG.email || !CFG.token) {
    toast('Completa todos los campos obligatorios', 'err');
    return;
  }

  // Actualizar sidebar con identidad del usuario
  document.getElementById('sidebarEmail').textContent  = CFG.email;
  document.getElementById('sidebarName').textContent   = CFG.name || CFG.email.split('@')[0];
  document.getElementById('sidebarAvatar').textContent = (CFG.name || CFG.email)[0].toUpperCase();

  document.getElementById('configOverlay').style.display = 'none';
  toast('Conectado · cargando datos...', 'inf');

  // Carga de datos iniciales en paralelo
  loadMisAsig();
  loadSinAsig();
  resolveMyAccountId();
}

/**
 * Abre el modal de configuración pre-rellenando los campos
 * con los valores actualmente almacenados en CFG.
 */
function openConfig() {
  document.getElementById('cfg_url').value   = CFG.url;
  document.getElementById('cfg_email').value = CFG.email;
  document.getElementById('cfg_token').value = CFG.token;
  document.getElementById('cfg_name').value  = CFG.name;
  document.getElementById('configOverlay').style.display = 'flex';
}

/**
 * Realiza una petición de prueba al endpoint /myself de Jira
 * con las credenciales ingresadas en el formulario (sin guardar aún).
 * Muestra un toast de éxito o error según la respuesta.
 *
 * @returns {Promise<void>}
 */
async function testConnection() {
  const url   = document.getElementById('cfg_url').value.trim().replace(/\/$/, '');
  const email = document.getElementById('cfg_email').value.trim();
  const token = document.getElementById('cfg_token').value.trim();

  try {
    const res = await fetch('/jira/rest/api/3/myself', {
      headers: {
        'jira_url':   url,
        'jira_email': email,
        'jira_token': token,
        'Accept':     'application/json',
      },
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.message || `HTTP ${res.status}`);
    toast(`✓ Conectado como ${r.displayName}`, 'ok');
  } catch (e) {
    toast('Error de conexión: ' + e.message, 'err');
  }
}

/**
 * Consulta el endpoint /myself de Jira y almacena el accountId
 * del usuario autenticado en CFG.accountId.
 * Este ID es necesario para la acción "Asignarme" en tickets.
 *
 * @returns {Promise<void>}
 */
async function resolveMyAccountId() {
  try {
    const me = await jira('GET', '/rest/api/3/myself');
    CFG.accountId = me.accountId;
  } catch {
    // No crítico: si falla, la función "Asignarme" seguirá usando el email como fallback
  }
}

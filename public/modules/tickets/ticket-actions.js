/**
 * ============================================================
 * MÓDULO: ticket-actions.js
 * ============================================================
 * Responsabilidad: Mutaciones sobre tickets existentes en Jira.
 * Cada función ejecuta una acción concreta (asignar, cerrar,
 * consultar transiciones) y luego refresca la tarjeta afectada
 * en el DOM sin recargar todo el panel.
 *
 * Expone:
 *  - ejecutarAsignar(key)   → reasigna un ticket a un usuario por email
 *  - ejecutarCierre(key)    → cierra un ticket vía backend con comentario
 *  - verTransiciones(key)   → muestra en un alert las transiciones disponibles
 *  - reloadCard(key)        → refresca una tarjeta individual en el DOM
 * ============================================================
 */

// ────────────────────────────────────────────────
//  ACCIÓN: REASIGNAR TICKET
// ────────────────────────────────────────────────

/**
 * Reasigna un ticket a un usuario de Jira buscándolo por email.
 *
 * Flujo:
 *  1. Lee el email del input inline de reasignación
 *  2. Busca el usuario en Jira por email (GET /user/search)
 *  3. Extrae su accountId (requerido por la API v3)
 *  4. Envía PUT /issue/{key}/assignee con el accountId
 *  5. Cierra el panel inline y recarga la tarjeta
 *
 * Notas:
 *  - La API de Jira v3 NO acepta email directamente en el body de assignee;
 *    requiere el accountId numérico. Por eso se hace la búsqueda previa.
 *  - Si el email no existe en el sistema, lanza un error descriptivo.
 *
 * @param {string} key - Clave del ticket (ej: 'INC-1234')
 * @returns {Promise<void>}
 */
async function ejecutarAsignar(key) {
  const email = document.getElementById('asig-input-' + key).value.trim();
  if (!email) { toast('Ingresa un correo', 'err'); return; }

  try {
    // Paso 1: Buscar el usuario por email para obtener su accountId
    const users = await jira('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
    if (!users.length) throw new Error(`Usuario no encontrado: ${email}`);

    const { accountId, displayName } = users[0];

    // Paso 2: Asignar el ticket usando el accountId
    await jira('PUT', `/rest/api/3/issue/${key}/assignee`, { accountId });

    toast(`✓ ${key} asignado a ${displayName}`, 'ok');
    document.getElementById('asig-' + key).classList.remove('open');

    // Refrescar solo esta tarjeta (no recarga todo el panel)
    reloadCard(key);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  ACCIÓN: CERRAR TICKET
// ────────────────────────────────────────────────

/**
 * Cierra un ticket enviando la solicitud al backend local,
 * que gestiona internamente las transiciones de Jira y los
 * campos personalizados requeridos.
 *
 * ¿Por qué va al backend y no directo a Jira?
 *  - Los IDs de transición de Jira son numéricos y específicos
 *    de cada instancia/proyecto. El backend los conoce y los
 *    abstrae del frontend.
 *  - El backend también puede actualizar campos de auditoría
 *    internos del sistema (no solo Jira).
 *
 * Flujo:
 *  1. Valida que haya comentario de cierre (campo obligatorio)
 *  2. Lee el tipo de atención de las opciones avanzadas (si están visibles)
 *     o usa 'remota' como valor por defecto
 *  3. POST /api/jira/ticket/{key}/close con { comment, tipo_atencion }
 *  4. Interpreta la respuesta:
 *     - data.jiraClosed === true  → cerrado en Jira Y sistema local
 *     - data.jiraClosed === false → solo cerrado localmente (warning)
 *  5. Cierra el panel inline y recarga la tarjeta
 *
 * @param {string} key - Clave del ticket
 * @returns {Promise<void>}
 */
async function ejecutarCierre(key) {
  const comment = document.getElementById('cerrar-com-' + key)?.value.trim();
  if (!comment) { toast('Agrega un comentario de cierre', 'err'); return; }

  // Determinar tipo de atención: leer del panel avanzado si está visible
  const advEl      = document.getElementById(`avanzado-${key}`);
  const advVisible = advEl && advEl.style.display !== 'none';
  const tipo_atencion = advVisible
    ? (document.getElementById(`cerrar-tipo-adv-${key}`)?.value || 'remota')
    : 'remota';

  toast(`Cerrando ${key}...`, 'inf');

  try {
    const res = await fetch(`/api/jira/ticket/${key}/close`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ comment, tipo_atencion }),
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Error del servidor (HTTP ${res.status})`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    // Diferenciar cierre completo vs. solo local
    if (data.jiraClosed) {
      toast(`✓ ${key} cerrado en Jira y sistema local`, 'ok');
    } else {
      toast(`⚠️ Cerrado localmente. ${data.message}`, 'inf');
    }

    document.getElementById('cerrar-' + key).classList.remove('open');
    reloadCard(key);

  } catch (e) {
    toast('Error al cerrar: ' + e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  ACCIÓN: PONER EN PENDIENTE
// ────────────────────────────────────────────────

/**
 * Transiciona un ticket de "Asignado" a "Pendiente" vía backend.
 * Requiere comentario obligatorio.
 *
 * @param {string} key - Clave del ticket (ej: 'INC-1234')
 */
async function ejecutarPendiente(key) {
  const comment = document.getElementById('pendiente-com-' + key)?.value.trim();
  if (!comment) { toast('Agrega un comentario', 'err'); return; }

  toast(`Actualizando ${key}...`, 'inf');

  try {
    const res = await fetch(`/api/jira/ticket/${key}/pending`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ comment }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    if (data.jiraOk) {
      toast(`✓ ${key} → Pendiente en Jira y sistema`, 'ok');
    } else {
      toast(`⚠️ ${data.message}`, 'inf');
    }

    document.getElementById('pendiente-' + key)?.classList.remove('open');
    reloadCard(key);

  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  ACCIÓN: REANUDAR (PENDIENTE → ASIGNADO)
// ────────────────────────────────────────────────

/**
 * Transiciona un ticket de "Pendiente" de vuelta a "Asignado" vía backend.
 *
 * @param {string} key - Clave del ticket (ej: 'INC-1234')
 */
async function ejecutarReanudar(key) {
  const comment = document.getElementById('reanudar-com-' + key)?.value.trim();
  if (!comment) { toast('Agrega un comentario', 'err'); return; }

  toast(`Reanudando ${key}...`, 'inf');

  try {
    const res = await fetch(`/api/jira/ticket/${key}/reanudar`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ comment }),
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error(`Error del servidor (HTTP ${res.status})`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    if (data.jiraOk) {
      toast(`✓ ${key} → Asignado (reanudado)`, 'ok');
    } else {
      toast(`⚠️ ${data.message}`, 'inf');
    }

    document.getElementById('reanudar-' + key)?.classList.remove('open');
    reloadCard(key);

  } catch (e) {
    toast('Error al reanudar: ' + e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  ACCIÓN: APLICAR TRANSICIÓN GENÉRICA
// ────────────────────────────────────────────────

/**
 * Aplica una transición de Jira seleccionada desde el listbox del badge de estado.
 *
 * @param {string} key            - Clave del ticket (ej: 'INC-1234')
 * @param {string} transitionId   - ID numérico de la transición en Jira
 * @param {string} transitionName - Nombre de la transición (para el toast)
 */
async function ejecutarTransicion(key, transitionId, transitionName) {
  toast(`Aplicando "${transitionName}"...`, 'inf');

  try {
    const res = await fetch(`/api/jira/ticket/${key}/transition`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ transitionId, transitionName }),
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error(`Error del servidor (HTTP ${res.status})`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    toast(`✓ ${key}: ${transitionName}`, 'ok');
    document.getElementById('trans-' + key)?.classList.remove('open');
    reloadCard(key);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  DEBUG: VER TRANSICIONES DISPONIBLES
// ────────────────────────────────────────────────

/**
 * Consulta las transiciones disponibles para un ticket y las
 * muestra en un alert nativo del navegador.
 *
 * Uso principal: depuración y configuración inicial.
 * Permite identificar los IDs de transición necesarios para
 * configurar el backend (que los usa al ejecutar cierres).
 *
 * Formato del alert:
 *  ID     Nombre                              → Estado destino
 *  31     Cerrar incidencia                   → CERRADO
 *  21     Escalar a N2                        → En N2
 *  ...
 *
 * @param {string} key - Clave del ticket
 * @returns {Promise<void>}
 */
async function verTransiciones(key) {
  try {
    const data  = await jira('GET', `/rest/api/3/issue/${key}/transitions`);
    const lines = data.transitions
      .map(t => `${t.id.padEnd(6)} ${t.name.padEnd(35)} → ${t.to.name}`)
      .join('\n');
    alert(`Transiciones de ${key}:\n\n${lines}`);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  RECARGA DE TARJETA INDIVIDUAL
// ────────────────────────────────────────────────

/**
 * Recarga los datos de un ticket desde Jira y reemplaza su tarjeta
 * en el DOM, sin refrescar todo el panel.
 *
 * Esto es preferible a reloadCurrent() cuando solo ha cambiado
 * un ticket (asignación, cierre, comentario) para evitar perder
 * el scroll y el estado visual del resto de tarjetas.
 *
 * Busca el elemento por id="card-{key}" y lo reemplaza con
 * outerHTML del nuevo renderTicket().
 *
 * Si el ticket no existe en el DOM (ej: fue eliminado mientras
 * tanto), la operación falla silenciosamente.
 *
 * @param {string} key - Clave del ticket (ej: 'INC-1234')
 * @returns {Promise<void>}
 */
async function reloadCard(key) {
  try {
    const issue = await jira(
      'GET',
      `/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter,priority,created,updated,comment`
    );
    const card = document.getElementById('card-' + key);
    if (card) card.outerHTML = renderTicket(issue);
  } catch {
    // Fallo silencioso: la tarjeta mantiene su estado anterior
    // El usuario puede refrescar el panel manualmente si lo necesita
  }
}

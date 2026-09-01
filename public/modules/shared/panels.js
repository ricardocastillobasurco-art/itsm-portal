/**
 * ============================================================
 * MÓDULO: panels.js
 * ============================================================
 * Responsabilidad: Flujos de negocio de cada panel de la aplicación.
 * Cada función orquesta: llamada a Jira → procesamiento de datos
 * → actualización del DOM. No genera HTML de tarjetas (eso es
 * responsabilidad de ticket-card.js).
 *
 * Expone:
 *  - loadMisAsig()      → carga tickets asignados al usuario actual
 *  - loadSinAsig()      → carga tickets sin asignar en el proyecto
 *  - buscarTicket()     → busca un ticket por su clave (INC-NNNN)
 *  - buscarHistorico()  → historial de tickets reportados por un email
 * ============================================================
 */

// ────────────────────────────────────────────────
//  PANEL: MIS ASIGNADOS
// ────────────────────────────────────────────────

/**
 * Carga y renderiza los tickets asignados al usuario autenticado
 * en el proyecto INC, excluyendo los cerrados.
 *
 * Lógica:
 *  1. Lee los filtros de la UI (estado y prioridad) para componer el JQL
 *  2. Muestra skeletons de carga mientras espera la respuesta
 *  3. Aplica el filtro de prioridad en cliente (Jira no filtra prioridad por nombre en JQL básico)
 *  4. Calcula estadísticas por estado y las muestra como stat-cards
 *  5. Renderiza las tarjetas o muestra un empty-state si no hay resultados
 *
 * JQL base: `project = INC AND assignee = "<email>" AND status != CERRADO ORDER BY updated DESC`
 *
 * @returns {Promise<void>}
 */
async function loadMisAsig() {
  const statusFilter = document.getElementById('filter-misAsig-status')?.value || '';
  const prioFilter   = document.getElementById('filter-misAsig-prio')?.value   || '';

  // Construir JQL según filtro de estado activo
  let jql = `project = INC AND assignee = "${CFG.email}" AND status != CERRADO ORDER BY updated DESC`;
  if (statusFilter) {
    jql = `project = INC AND assignee = "${CFG.email}" AND status = "${statusFilter}" ORDER BY updated DESC`;
  }

  const list = document.getElementById('list-misAsig');

  // Indicador de carga: 3 skeletons animados
  list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  try {
    const data = await jira(
      'GET',
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50`
      + `&fields=summary,status,assignee,reporter,priority,created,updated,comment,creator`
    );

    // Filtrar por prioridad en cliente (filtro adicional, no disponible directamente en JQL)
    const issues = (data.issues || []).filter(i => {
      if (!prioFilter) return true;
      return (i.fields?.priority?.name || '').toLowerCase() === prioFilter.toLowerCase();
    });

    // Actualizar badge de navegación y subtítulo del topbar
    const total = data.total ?? issues.length;
    document.getElementById('badge-misAsig').textContent = total;
    document.getElementById('topbarSub').textContent     = `${total} tickets`;

    // Calcular distribución por estado para las stat-cards
    const byStatus = {};
    issues.forEach(i => {
      const s = i.fields.status?.name || '—';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });

    // Renderizar stat-cards (una por estado + total cargados)
    const statsEl = document.getElementById('stats-misAsig');
    statsEl.innerHTML =
      Object.entries(byStatus).map(([s, n]) => `
        <div class="stat-card">
          <div class="stat-val ${
            statusClass(s)
              .replace('s-', 'c-')
              .replace('n1',   'blue')
              .replace('n2',   'amber')
              .replace('n3',   'amber')
              .replace('pend', 'blue')
              .replace('res',  'green')
              .replace('cerr', 'blue')
          }">${n}</div>
          <div class="stat-lbl">${s}</div>
        </div>`
      ).join('') +
      `<div class="stat-card">
         <div class="stat-val c-blue">${issues.length}</div>
         <div class="stat-lbl">Total cargados</div>
       </div>`;

    // Renderizar tarjetas o estado vacío
    if (!issues.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <p>No tienes tickets asignados</p>
        </div>`;
      return;
    }
    list.innerHTML = issues.map(i => renderTicket(i)).join('');

  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Error: ${esc(e.message)}</p></div>`;
    toast(e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  PANEL: SIN ASIGNAR
// ────────────────────────────────────────────────

/**
 * Carga y renderiza los tickets del proyecto INC que no tienen
 * ningún asignado y no están cerrados.
 *
 * JQL: `project = INC AND assignee is EMPTY AND status != CERRADO ORDER BY created DESC`
 *
 * Muestra una stat-card con el total de tickets sin asignar y
 * un badge de alerta en el ítem de navegación.
 *
 * @returns {Promise<void>}
 */
async function loadSinAsig() {
  const jql  = `project = INC AND assignee is EMPTY AND status != CERRADO ORDER BY created DESC`;
  const list = document.getElementById('list-sinAsig');

  // Indicador de carga
  list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';

  try {
    const data = await jira(
      'GET',
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50`
      + `&fields=summary,status,assignee,reporter,priority,created,updated,comment`
    );

    const totalSin = data.total ?? (data.issues || []).length;

    // Actualizar badge de navegación
    document.getElementById('badge-sinAsig').textContent = totalSin;

    // Stat-card resumen
    const statsEl = document.getElementById('stats-sinAsig');
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-val c-amber">${totalSin}</div>
        <div class="stat-lbl">Sin asignar</div>
      </div>`;

    const issues = data.issues || [];
    if (!issues.length) {
      list.innerHTML = `<div class="empty-state"><p>No hay tickets sin asignar</p></div>`;
      return;
    }
    list.innerHTML = issues.map(i => renderTicket(i)).join('');

  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Error: ${esc(e.message)}</p></div>`;
    toast(e.message, 'err');
  }
}

// ────────────────────────────────────────────────
//  PANEL: BUSCAR TICKET
// ────────────────────────────────────────────────

/**
 * Busca un ticket específico por su clave (INC-NNNN) y lo renderiza.
 *
 * Normalización de entrada:
 *  - Si el valor ya tiene prefijo 'INC-', se usa tal cual
 *  - Si es solo un número, se antepone 'INC-' automáticamente
 *
 * Lee el valor del input #searchInput y escribe el resultado
 * en #result-buscar.
 *
 * @returns {Promise<void>}
 */
async function buscarTicket() {
  const val = document.getElementById('searchInput').value.trim();
  if (!val) return;

  // Normalizar la clave del ticket
  const key = val.toUpperCase().startsWith('INC-') ? val.toUpperCase() : 'INC-' + val;
  const res = document.getElementById('result-buscar');

  res.innerHTML = '<div class="skeleton"></div>';

  try {
    const issue = await jira(
      'GET',
      `/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter,priority,created,updated,comment`
    );
    res.innerHTML = renderTicket(issue);
  } catch (e) {
    res.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <p>No se encontró <b>${key}</b> — ${esc(e.message)}</p>
      </div>`;
  }
}

// ────────────────────────────────────────────────
//  PANEL: HISTÓRICO
// ────────────────────────────────────────────────

/**
 * Busca el historial de tickets reportados por un usuario (email)
 * en el proyecto INC, con un rango de días configurable.
 *
 * Parámetros leídos del DOM:
 *  - #histEmail  → correo del reporter a consultar
 *  - #histDays   → número de días hacia atrás ('0' = sin límite)
 *
 * JQL base:  `project = INC AND reporter = "<email>" ORDER BY created DESC`
 * JQL c/días: `project = INC AND reporter = "<email>" AND created >= -Nd ORDER BY created DESC`
 *
 * Muestra tres stat-cards: Total, Abiertos y Cerrados.
 *
 * @returns {Promise<void>}
 */
async function buscarHistorico() {
  const email = document.getElementById('histEmail').value.trim();
  const days  = document.getElementById('histDays').value;

  if (!email) { toast('Ingresa un correo', 'err'); return; }

  // Construir JQL con o sin ventana temporal
  let jql = `project = INC AND reporter = "${email}" ORDER BY created DESC`;
  if (days && days !== '0') {
    jql = `project = INC AND reporter = "${email}" AND created >= -${days}d ORDER BY created DESC`;
  }

  const res = document.getElementById('result-historico');
  res.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';

  try {
    const data = await jira(
      'GET',
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100`
      + `&fields=summary,status,assignee,reporter,priority,created,updated,comment`
    );

    const issues = data.issues || [];
    const total  = data.total ?? issues.length;
    document.getElementById('topbarSub').textContent = `${total} tickets encontrados`;

    if (!issues.length) {
      res.innerHTML = `<div class="empty-state"><p>Sin tickets para <b>${esc(email)}</b></p></div>`;
      return;
    }

    // Calcular abiertos vs cerrados para las stat-cards
    const open   = issues.filter(i => !i.fields.status?.name.toLowerCase().includes('cerr')).length;
    const closed = issues.length - open;

    res.innerHTML = `
      <div class="stats-row" style="margin-bottom:16px;">
        <div class="stat-card"><div class="stat-val c-blue">${total}</div><div class="stat-lbl">Total</div></div>
        <div class="stat-card"><div class="stat-val c-amber">${open}</div><div class="stat-lbl">Abiertos</div></div>
        <div class="stat-card"><div class="stat-val c-green">${closed}</div><div class="stat-lbl">Cerrados</div></div>
      </div>
      <div class="ticket-list">${issues.map(i => renderTicket(i)).join('')}</div>`;

  } catch (e) {
    res.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Error: ${esc(e.message)}</p></div>`;
    toast(e.message, 'err');
  }
}

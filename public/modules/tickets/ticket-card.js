/**
 * ============================================================
 * MÓDULO: ticket-card.js
 * ============================================================
 * Responsabilidad: Generación del HTML de las tarjetas de ticket
 * y toda la lógica de los formularios inline (reasignar / cerrar).
 *
 * Expone:
 *  - renderTicket(issue, opts)       → HTML string de una tarjeta completa
 *  - extractText(body)               → extrae texto plano de cuerpo ADF o string
 *  - toggleAsig(key)                 → muestra/oculta el panel inline de reasignación
 *  - toggleCerrar(key)               → muestra/oculta el panel inline de cierre
 *  - asignarmeAMi(key)               → rellena el campo de email con el usuario actual
 *  - toggleAvanzado(key)             → expande/colapsa las opciones avanzadas de cierre
 *  - actualizarLabel(key)            → sincroniza el resumen de opciones avanzadas
 *  - updateResultadoHijoAdv(key)     → actualiza opciones del select "hijo" según el "padre"
 * ============================================================
 */

/**
 * Árbol de opciones de "Resultado hijo" en función del "Resultado padre".
 * Se usa para poblar dinámicamente el segundo select de opciones avanzadas
 * al cerrar un ticket. La clave es el nombre exacto del valor del select padre.
 *
 * @type {Object.<string, string[]>}
 */
const RESULTADO_HIJOS = {
  'Amdocs':             ['Cambio en Amdocs', 'Asociado a Drop'],
  'Infraestructura':    ['Intermitencia', 'Automatismo', 'Asociado a Drop'],
  'Automatismo':        ['Automatismo'],
  'Otros':              ['Otros'],
  'Asociado a PaP':     ['Asociado a PaP'],
  'Deuda técnica':      ['Deuda técnica', 'GAP funcional', 'Inconsistencia de datos', 'Operativa de usuario'],
  'Resuelto en N3':     ['Resuelto en N3'],
  'Seguridad':          ['Seguridad'],
  'Servicios Externos': ['Equifax', 'Reniec', 'Portabilidad'],
  'Workplace':          ['Workplace', 'Sin acción - Orden completada', 'Sin acción - Orden cancelada'],
};

// ────────────────────────────────────────────────
//  EXTRACCIÓN DE TEXTO
// ────────────────────────────────────────────────

/**
 * Extrae hasta 300 caracteres de texto legible desde el cuerpo
 * de un comentario Jira, que puede estar en formato ADF (Object)
 * o en texto plano (string).
 *
 * Para ADF, hace un recorrido recursivo del árbol de nodos
 * recolectando todos los nodos de tipo 'text'.
 *
 * @param {Object|string|null} body - Cuerpo del comentario
 * @returns {string} Texto escapado (máx. 300 chars) o '—' si no hay contenido
 */
function extractText(body) {
  if (!body) return '—';
  if (typeof body === 'string') return esc(body).slice(0, 300);

  try {
    const texts = [];
    const walk  = (node) => {
      if (node.type === 'text') texts.push(node.text || '');
      (node.content || []).forEach(walk);
    };
    walk(body);
    return esc(texts.join(' ').slice(0, 300));
  } catch {
    return '—';
  }
}

// ────────────────────────────────────────────────
//  RENDER PRINCIPAL
// ────────────────────────────────────────────────

/**
 * Genera el HTML completo de una tarjeta de ticket.
 *
 * La tarjeta contiene:
 *  - Encabezado: key, resumen, badge de estado
 *  - Metadatos: asignado, reporter, prioridad, fechas de creación y actualización
 *  - Último comentario (si existe), con autor y fecha
 *  - Barra de acciones: Reasignar, Cerrar, Transiciones, Enlace a Jira
 *  - Panel inline de reasignación (oculto por defecto, se muestra con toggleAsig)
 *  - Panel inline de cierre (oculto por defecto, se muestra con toggleCerrar)
 *    └── Sub-panel de opciones avanzadas: tipo resolución, proceso, resultado padre/hijo, tipo de atención
 *
 * Los tickets con estado "cerrado" reemplazan el botón "Cerrar" por
 * un indicador estático "✓ cerrado".
 *
 * @param {Object} issue     - Objeto issue tal como lo devuelve la API de Jira
 * @param {Object} [opts={}] - Opciones de renderizado (reservado para extensiones futuras)
 * @returns {string} Markup HTML de la tarjeta lista para insertarse con innerHTML
 */
function renderTicket(issue, opts = {}) {
  const f    = issue.fields || {};
  const key  = issue.key;
  const sum  = f.summary              || '(sin resumen)';
  const st   = f.status?.name         || '—';
  const pr   = f.priority?.name       || '—';
  const asgn = f.assignee?.emailAddress || 'Sin asignar';
  const rep  = f.reporter?.emailAddress || f.creator?.emailAddress || '—';
  const crea = fmtDate(f.created);
  const upd  = fmtDate(f.updated);

  const stL         = st.toLowerCase();
  const isClosed    = /cerr|resuelto|resolved|done|completado|finalizado/.test(stL);
  const isPendiente = !isClosed && stL.includes('pendiente');
  // isActive: cualquier estado de trabajo (En N1, En N2, En N3, Asignado, In Progress, etc.)
  const isActive    = !isClosed && !isPendiente;

  // Último comentario del ticket (el más reciente en el array)
  const comments   = f.comment?.comments || [];
  const lastComment = comments[comments.length - 1];
  const commentHtml = lastComment
    ? `<div class="tc-comment">
         <div class="cm-author">${lastComment.author?.displayName || '—'} · ${fmtDate(lastComment.created)}</div>
         ${extractText(lastComment.body)}
       </div>`
    : '';

  return `
  <div class="ticket-card" id="card-${key}">

    <!-- ENCABEZADO ─────────────────────────────── -->
    <div class="tc-top">
      <span class="tc-key">${key}</span>
      <span class="tc-summary">
        <span class="prio ${prioClass(pr)}"></span>${esc(sum)}
      </span>
      <span class="status-badge ${statusClass(st)}" onclick="toggleTransitions('${key}')" style="cursor:pointer;" title="Ver transiciones">${st}</span>
    </div>

    <!-- METADATOS ──────────────────────────────── -->
    <div class="tc-meta">
      <span>Asignado: <b>${esc(asgn)}</b></span>
      <span>Reporter: <b>${esc(rep)}</b></span>
      <span>Prioridad: <b>${esc(pr)}</b></span>
      <span>Creado: <b>${crea}</b></span>
      <span>Actualizado: <b>${upd}</b></span>
    </div>

    <!-- ÚLTIMO COMENTARIO ──────────────────────── -->
    ${commentHtml}

    <!-- BARRA DE ACCIONES ──────────────────────── -->
    <div class="tc-actions">
      <button class="btn btn-ghost btn-sm" onclick="toggleAsig('${key}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Reasignar
      </button>

      ${isPendiente
        ? `<button class="btn btn-ghost btn-sm" style="color:#6366f1;" onclick="toggleReanudar('${key}')">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
             </svg>
             Reanudar
           </button>`
        : ''
      }

      ${isActive
        ? `<button class="btn btn-ghost btn-sm" style="color:#b45309;" onclick="togglePendiente('${key}')">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
             </svg>
             Poner en Pendiente
           </button>`
        : ''
      }

      ${!isClosed
        ? `<button class="btn btn-red btn-sm" onclick="toggleCerrar('${key}')">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <polyline points="20 6 9 17 4 12"/>
             </svg>
             Cerrar incidencia
           </button>`
        : '<span style="font-size:11px;color:var(--text3);font-family:var(--mono);">✓ cerrado</span>'
      }

      <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="verTransiciones('${key}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        Transiciones
      </button>

      <a href="${CFG.url}/browse/${key}" target="_blank" class="btn btn-ghost btn-sm" style="text-decoration:none;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Jira
      </a>
    </div>

    <!-- PANEL INLINE: REASIGNAR ────────────────── -->
    <!--
      Visible solo cuando el usuario presiona "Reasignar".
      Permite buscar por email o usar "Asignarme" para auto-completar.
    -->
    <div class="asig-inline" id="asig-${key}">
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:8px;">ASIGNAR A</div>
      <div class="asig-row">
        <input id="asig-input-${key}" type="email" placeholder="correo@empresa.com" value="">
        <button class="btn btn-ghost btn-sm" onclick="asignarmeAMi('${key}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          Asignarme
        </button>
        <button class="btn btn-blue btn-sm" onclick="ejecutarAsignar('${key}')">Asignar</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleAsig('${key}')">✕</button>
      </div>
    </div>

    <!-- PANEL INLINE: REANUDAR ─────────────────────── -->
    <div class="cerrar-inline" id="reanudar-${key}" style="border-color:rgba(99,102,241,.35);">
      <div style="font-size:11px;color:#6366f1;font-family:var(--mono);margin-bottom:10px;">
        REANUDAR TICKET · ${key}
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:5px;">COMENTARIO *</div>
      <textarea
        id="reanudar-com-${key}"
        placeholder="Motivo por el que se reactiva el ticket..."
        style="width:100%;background:var(--bg4);border:1px solid rgba(99,102,241,.4);border-radius:var(--radius);padding:10px 12px;color:var(--text);font-size:13px;outline:none;resize:vertical;min-height:72px;margin-bottom:10px;font-family:var(--sans);"
      ></textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm" style="background:#6366f1;color:#fff;border:none;" onclick="ejecutarReanudar('${key}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
          </svg>
          Confirmar
        </button>
        <button class="btn btn-ghost btn-sm" onclick="toggleReanudar('${key}')">Cancelar</button>
      </div>
    </div>

    <!-- PANEL INLINE: PONER EN PENDIENTE ──────────── -->
    <div class="cerrar-inline" id="pendiente-${key}" style="border-color:rgba(234,179,8,.35);">
      <div style="font-size:11px;color:#b45309;font-family:var(--mono);margin-bottom:10px;">
        PONER EN PENDIENTE · ${key}
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:5px;">COMENTARIO *</div>
      <textarea
        id="pendiente-com-${key}"
        placeholder="Motivo o detalle del estado pendiente..."
        style="width:100%;background:var(--bg4);border:1px solid rgba(234,179,8,.4);border-radius:var(--radius);padding:10px 12px;color:var(--text);font-size:13px;outline:none;resize:vertical;min-height:72px;margin-bottom:10px;font-family:var(--sans);"
      ></textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm" style="background:#b45309;color:#fff;border:none;" onclick="ejecutarPendiente('${key}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Confirmar
        </button>
        <button class="btn btn-ghost btn-sm" onclick="togglePendiente('${key}')">Cancelar</button>
      </div>
    </div>

    <!-- PANEL INLINE: CERRAR INCIDENCIA ────────── -->
    <!--
      Visible solo cuando el usuario presiona "Cerrar incidencia".
      Campos obligatorios: comentario de cierre.
      Opciones avanzadas (expandibles): tipo de resolución, proceso impactado,
      resultado padre/hijo (cascada) y tipo de atención (remota/presencial).
    -->
    <div class="cerrar-inline" id="cerrar-${key}">
      <div style="font-size:11px;color:var(--red);font-family:var(--mono);margin-bottom:10px;">
        CERRAR INCIDENCIA · ${key}
      </div>

      <!-- Campo obligatorio: comentario de cierre -->
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:5px;">COMENTARIO DE CIERRE *</div>
      <textarea
        id="cerrar-com-${key}"
        placeholder="Describe cómo se resolvió el problema..."
        style="width:100%;background:var(--bg4);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);padding:10px 12px;color:var(--text);font-size:13px;outline:none;resize:vertical;min-height:72px;margin-bottom:8px;font-family:var(--sans);"
      ></textarea>

      <!-- Toggle: opciones avanzadas colapsables -->
      <div style="margin-bottom:10px;">
        <button class="btn btn-ghost btn-sm" onclick="toggleAvanzado('${key}')" style="font-size:11px;color:var(--text3);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          Opciones avanzadas — Resolución:
          <b id="lbl-res-${key}" style="color:var(--text2);">Resuelto · WORKPLACE · remota</b>
        </button>

        <!-- Campos avanzados (ocultos por defecto) -->
        <div id="avanzado-${key}" style="display:none;margin-top:10px;">

          <!-- Fila 1: Tipo de resolución + Proceso impactado -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <div>
              <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px;">TIPO DE RESOLUCIÓN</div>
              <select onchange="actualizarLabel('${key}')" id="cerrar-res-adv-${key}"
                style="width:100%;background:var(--bg4);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text);font-size:12px;outline:none;">
                <option>Resuelto</option>
                <option>Reinicio de servicio</option>
                <option>Aplicación de workaround</option>
                <option>Orientación al usuario</option>
                <option>Sin acción correctiva</option>
                <option>Ticket duplicado</option>
                <option>Cese de alarma</option>
                <option>Resueltos por tren</option>
                <option>Desarrollo de Hotfix</option>
                <option>Cierre masivo</option>
              </select>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px;">PROCESO IMPACTADO</div>
              <select id="cerrar-proc-adv-${key}" onchange="actualizarLabel('${key}')"
                style="width:100%;background:var(--bg4);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text);font-size:12px;outline:none;">
                <option>WORKPLACE</option><option>PLATAFORMAS</option>
                <option>LOGIN APP MIMOVISTAR</option><option>ECOMMERCE</option>
                <option>VENTAS MOVIL</option><option>VENTAS FIJA</option>
                <option>AVERÍAS</option><option>RECLAMOS</option>
                <option>ALERTA P1</option><option>PORT IN</option>
                <option>PORT OUT</option><option>JIRA</option>
                <option>SISTEMAS</option><option>INFRAESTRUCTURA</option>
              </select>
            </div>
          </div>

          <!-- Fila 2: Resultado padre + Resultado hijo (cascada) -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <div>
              <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px;">RESULTADO (padre)</div>
              <select id="cerrar-rpadre-adv-${key}"
                onchange="updateResultadoHijoAdv('${key}'); actualizarLabel('${key}')"
                style="width:100%;background:var(--bg4);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text);font-size:12px;outline:none;">
                <option>Workplace</option><option>Amdocs</option>
                <option>Infraestructura</option><option>Automatismo</option>
                <option>Otros</option><option>Asociado a PaP</option>
                <option>Deuda técnica</option><option>Resuelto en N3</option>
                <option>Seguridad</option><option>Servicios Externos</option>
              </select>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px;">RESULTADO (hijo)</div>
              <select id="cerrar-rhijo-adv-${key}" onchange="actualizarLabel('${key}')"
                style="width:100%;background:var(--bg4);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text);font-size:12px;outline:none;">
                <option>Workplace</option>
                <option>Sin acción - Orden completada</option>
                <option>Sin acción - Orden cancelada</option>
              </select>
            </div>
          </div>

          <!-- Fila 3: Tipo de atención -->
          <div>
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px;">TIPO DE ATENCIÓN</div>
            <select id="cerrar-tipo-adv-${key}" onchange="actualizarLabel('${key}')"
              style="width:160px;background:var(--bg4);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text);font-size:12px;outline:none;">
              <option value="remota">Remota</option>
              <option value="presencial">Presencial</option>
            </select>
          </div>

        </div><!-- /avanzado -->
      </div>

      <!-- Botones de acción del panel de cierre -->
      <div style="display:flex;gap:8px;">
        <button class="btn btn-red btn-sm" onclick="ejecutarCierre('${key}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Confirmar cierre
        </button>
        <button class="btn btn-ghost btn-sm" onclick="toggleCerrar('${key}')">Cancelar</button>
      </div>
    </div>

    <!-- PANEL INLINE: TRANSICIONES ────────────────── -->
    <div class="cerrar-inline" id="trans-${key}" style="border-color:rgba(99,102,241,.3);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:11px;color:#6366f1;font-family:var(--mono);">TRANSICIONES DISPONIBLES · ${key}</span>
        <button class="btn btn-ghost btn-sm" onclick="toggleTransitions('${key}')" style="padding:2px 6px;">✕</button>
      </div>
      <div id="trans-list-${key}">
        <span style="font-size:12px;color:var(--text3);">Cargando...</span>
      </div>
    </div>

  </div>`;
}

// ────────────────────────────────────────────────
//  CONTROLADORES DE PANELES INLINE
// ────────────────────────────────────────────────

/**
 * Alterna la visibilidad del panel inline de reasignación de un ticket.
 * Si el panel de cierre está abierto, lo cierra primero (solo uno a la vez).
 * Al abrir, mueve el foco al campo de email.
 *
 * @param {string} key - Clave del ticket (ej: 'INC-1234')
 */
function _closeAllPanels(key) {
  ['asig','cerrar','pendiente','reanudar','trans'].forEach(p =>
    document.getElementById(`${p}-${key}`)?.classList.remove('open')
  );
}

async function toggleTransitions(key) {
  const el = document.getElementById('trans-' + key);
  if (!el) return;
  const wasOpen = el.classList.contains('open');
  _closeAllPanels(key);
  if (wasOpen) return;

  el.classList.add('open');
  const listEl = document.getElementById('trans-list-' + key);
  if (listEl) listEl.innerHTML = '<span style="font-size:12px;color:var(--text3);">Cargando...</span>';

  try {
    const res = await fetch(`/api/jira/ticket/${key}/transitions`, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (!data.transitions.length) {
      listEl.innerHTML = '<span style="font-size:12px;color:var(--text3);">No hay transiciones disponibles</span>';
      return;
    }

    listEl.innerHTML = data.transitions.map(t => `
      <button class="btn btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin-bottom:4px;font-size:13px;"
        onclick="ejecutarTransicion('${key}','${t.id}',${JSON.stringify(t.name)})">
        ${esc(t.name)}<span style="font-size:10px;color:var(--text3);margin-left:6px;">→ ${esc(t.to)}</span>
      </button>
    `).join('');
  } catch (e) {
    if (listEl) listEl.innerHTML = `<span style="font-size:12px;color:var(--red);">Error: ${esc(e.message)}</span>`;
  }
}

function toggleAsig(key) {
  const el = document.getElementById('asig-' + key);
  const wasOpen = el.classList.contains('open');
  _closeAllPanels(key);
  if (!wasOpen) { el.classList.add('open'); document.getElementById('asig-input-' + key).focus(); }
}

function toggleCerrar(key) {
  const el = document.getElementById('cerrar-' + key);
  const wasOpen = el.classList.contains('open');
  _closeAllPanels(key);
  if (!wasOpen) el.classList.add('open');
}

function togglePendiente(key) {
  const el = document.getElementById('pendiente-' + key);
  if (!el) return;
  const wasOpen = el.classList.contains('open');
  _closeAllPanels(key);
  if (!wasOpen) { el.classList.add('open'); document.getElementById('pendiente-com-' + key)?.focus(); }
}

function toggleReanudar(key) {
  const el = document.getElementById('reanudar-' + key);
  if (!el) return;
  const wasOpen = el.classList.contains('open');
  _closeAllPanels(key);
  if (!wasOpen) { el.classList.add('open'); document.getElementById('reanudar-com-' + key)?.focus(); }
}

/**
 * Rellena el campo de email del panel de reasignación con la dirección
 * del usuario actualmente autenticado (tomada de CFG.email).
 * Atajo conveniente para que los agentes se auto-asignen tickets.
 *
 * @param {string} key - Clave del ticket
 */
function asignarmeAMi(key) {
  document.getElementById('asig-input-' + key).value = CFG.email;
}

// ────────────────────────────────────────────────
//  OPCIONES AVANZADAS DE CIERRE
// ────────────────────────────────────────────────

/**
 * Muestra u oculta el sub-panel de opciones avanzadas dentro del
 * formulario de cierre de un ticket.
 *
 * @param {string} key - Clave del ticket
 */
function toggleAvanzado(key) {
  const el = document.getElementById(`avanzado-${key}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

/**
 * Actualiza las opciones del select "Resultado hijo" en función del
 * valor seleccionado en "Resultado padre" (relación de cascada).
 * Usa el mapa RESULTADO_HIJOS para determinar los valores válidos.
 *
 * @param {string} key - Clave del ticket
 */
function updateResultadoHijoAdv(key) {
  const padre   = document.getElementById(`cerrar-rpadre-adv-${key}`)?.value || '';
  const hijoSel = document.getElementById(`cerrar-rhijo-adv-${key}`);
  if (!hijoSel) return;

  const hijos = RESULTADO_HIJOS[padre] || [];
  hijoSel.innerHTML = hijos.map(h => `<option value="${h}">${h}</option>`).join('');
}

/**
 * Sincroniza el texto del resumen visible junto al toggle de opciones
 * avanzadas con los valores actuales de los selectores.
 * Se llama cada vez que cambia cualquier opción avanzada (onchange).
 *
 * Formato del label: "Resuelto · WORKPLACE · remota"
 *
 * @param {string} key - Clave del ticket
 */
function actualizarLabel(key) {
  const res   = document.getElementById(`cerrar-res-adv-${key}`)?.value    || 'Resuelto';
  const padre = document.getElementById(`cerrar-rpadre-adv-${key}`)?.value || 'Workplace';
  const tipo  = document.getElementById(`cerrar-tipo-adv-${key}`)?.value   || 'remota';
  const lbl   = document.getElementById(`lbl-res-${key}`);
  if (lbl) lbl.textContent = `${res} · ${padre} · ${tipo}`;
}

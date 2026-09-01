/**
 * ============================================================
 * MÓDULO: ui-helpers.js
 * ============================================================
 * Responsabilidad: Utilidades transversales de interfaz de usuario.
 * Contiene funciones puras (sin efectos en Jira) que se usan
 * en múltiples paneles: notificaciones toast, clasificación
 * visual de estados/prioridades, formateo de fechas, navegación
 * entre paneles y escape de HTML.
 *
 * Expone:
 *  - toast(msg, type)         → notificación flotante temporal
 *  - statusClass(statusName)  → clase CSS según estado del ticket
 *  - prioClass(prioName)      → clase CSS según prioridad
 *  - fmtDate(dateString)      → fecha en formato legible
 *  - showPanel(name, el)      → activa un panel y actualiza navegación
 *  - reloadCurrent()          → recarga el panel activo
 *  - esc(s)                   → escapa HTML para prevenir XSS
 * ============================================================
 */

/**
 * Muestra una notificación flotante (toast) en la esquina de la pantalla.
 * Se auto-destruye a los 4 segundos.
 *
 * @param {string} msg              - Texto del mensaje a mostrar
 * @param {'ok'|'err'|'inf'} type   - Tipo visual del toast
 *   - 'ok'  → confirmación verde  (✓)
 *   - 'err' → error rojo          (✗)
 *   - 'inf' → informativo neutro  (·)
 */
function toast(msg, type = 'inf') {
  const box  = document.getElementById('toastBox');
  const d    = document.createElement('div');
  const ico  = { ok: '✓', err: '✗', inf: '·' }[type] || '·';
  d.className = `toast ${type}`;
  d.innerHTML = `<span class="toast-ico">${ico}</span><span>${msg}</span>`;
  box.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

/**
 * Devuelve una clase CSS que codifica el color del badge de estado
 * de un ticket Jira. La clasificación se basa en palabras clave
 * del nombre del estado (case-insensitive).
 *
 * Mapeo de clases → colores esperados en el stylesheet:
 *  s-n1   → azul oscuro  (N1 / criticidad alta)
 *  s-n2   → naranja      (N2)
 *  s-n3   → amarillo     (N3)
 *  s-pend → gris/azul    (Pendiente / default)
 *  s-res  → verde        (Resuelto / Suelto)
 *  s-cerr → gris         (Cerrado)
 *
 * @param {string} [s=''] - Nombre del estado (ej: 'En N1', 'CERRADO')
 * @returns {string} Nombre de la clase CSS correspondiente
 */
function statusClass(s = '') {
  const v = s.toLowerCase();
  if (v.includes('n1'))     return 's-n1';
  if (v.includes('n2'))     return 's-n2';
  if (v.includes('n3'))     return 's-n3';
  if (v.includes('pend'))   return 's-pend';
  if (v.includes('suelto')) return 's-res';
  if (v.includes('cerr'))   return 's-cerr';
  return 's-pend'; // fallback: estado desconocido → pendiente
}

/**
 * Devuelve una clase CSS para el indicador de prioridad del ticket.
 * Soporta los nombres en español e inglés que usa Jira.
 *
 * Mapeo:
 *  prio-alta  → Alta / High / Highest / Critical
 *  prio-baja  → Baja / Low / Lowest
 *  prio-media → Media / Medium (y cualquier otro valor)
 *
 * @param {string} [p=''] - Nombre de la prioridad
 * @returns {string} Clase CSS
 */
function prioClass(p = '') {
  const v = p.toLowerCase();
  if (v === 'alta' || v === 'high' || v === 'highest' || v === 'critical') return 'prio-alta';
  if (v === 'baja' || v === 'low'  || v === 'lowest')                      return 'prio-baja';
  return 'prio-media';
}

/**
 * Formatea una fecha ISO 8601 a un string legible en español (Perú).
 * Retorna '—' si el valor es nulo, undefined o vacío.
 *
 * @param {string|null|undefined} d - Fecha en formato ISO (ej: '2024-03-15T10:30:00.000Z')
 * @returns {string} Fecha formateada (ej: '15 mar. 2024') o '—'
 */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PE', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

/**
 * Registra el panel actualmente visible. Se usa en reloadCurrent()
 * para saber qué función de recarga invocar.
 * @type {string}
 */
let _currentPanel = 'misAsig';

/**
 * Activa un panel de la aplicación (SPA sin router):
 *  1. Remueve .active de todos los paneles y nav-items
 *  2. Añade .active al panel y nav-item seleccionados
 *  3. Actualiza el título y subtítulo del topbar
 *  4. Actualiza _currentPanel para que reloadCurrent() sepa qué recargar
 *
 * @param {string}          name - Identificador del panel (ej: 'misAsig', 'sinAsig')
 * @param {HTMLElement|null} el  - Elemento de navegación que se debe marcar como activo
 */
function showPanel(name, el) {
  // Desactivar todo
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activar el seleccionado
  document.getElementById('panel-' + name).classList.add('active');
  if (el) el.classList.add('active');

  _currentPanel = name;

  // Actualizar encabezado
  const titles = {
    misAsig:   'Mis asignados',
    sinAsig:   'Sin asignar',
    buscar:    'Buscar ticket',
    historico: 'Histórico de tickets',
  };
  const t = document.getElementById('topbarTitle') || document.getElementById('incTopbarTitle');
  if (t) t.textContent = titles[name] || name;
  const s = document.getElementById('topbarSub') || document.getElementById('incTopbarSub');
  if (s) s.textContent = '';
}

/**
 * Recarga los datos del panel actualmente visible.
 * Solo aplica a paneles con carga dinámica (misAsig y sinAsig).
 * Los paneles de búsqueda requieren acción explícita del usuario.
 */
function reloadCurrent() {
  if (_currentPanel === 'misAsig') loadMisAsig();
  if (_currentPanel === 'sinAsig') loadSinAsig();
}

/**
 * Escapa caracteres HTML especiales para prevenir inyección XSS.
 * Usa la API del DOM (textContent) para garantizar un escape correcto
 * sin necesidad de listas de reemplazos manuales.
 *
 * @param {string} s - Cadena potencialmente insegura
 * @returns {string} Cadena con entidades HTML escapadas
 *
 * @example
 * esc('<script>alert(1)</script>')
 * // → '&lt;script&gt;alert(1)&lt;/script&gt;'
 */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

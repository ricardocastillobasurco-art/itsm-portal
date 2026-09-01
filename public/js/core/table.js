/**
 * AppTable — Simple declarative table renderer.
 * No jQuery dependency. Works with any <table> element.
 *
 * Usage:
 *   AppTable.render('#myTable', [
 *     { key: 'full_name', label: 'Nombre' },
 *     { key: 'email',     label: 'Correo' },
 *     { key: 'is_active', label: 'Estado', render: v => v ? '<span class="badge bg-success">Activo</span>' : '<span class="badge bg-secondary">Baja</span>' },
 *   ], rows);
 *
 *   AppTable.empty('#myTable', 'Sin empleados');
 *   AppTable.error('#myTable', 'Error al cargar datos');
 */
window.AppTable = (() => {
  function _el(selector) {
    return typeof selector === 'string' ? document.querySelector(selector) : selector;
  }

  function render(tableSelector, columns, rows) {
    const table = _el(tableSelector);
    if (!table) return;

    // thead
    let thead = table.querySelector('thead');
    if (!thead) { thead = document.createElement('thead'); table.prepend(thead); }
    thead.innerHTML = `<tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr>`;

    // tbody
    let tbody = table.querySelector('tbody');
    if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }

    if (!rows || !rows.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}" class="text-center text-muted py-4">Sin registros</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row =>
      `<tr>${columns.map(c => {
        const val = c.key ? row[c.key] : undefined;
        const cell = c.render ? c.render(val, row) : (val ?? '—');
        return `<td>${cell}</td>`;
      }).join('')}</tr>`
    ).join('');
  }

  function empty(tableSelector, msg = 'Sin registros') {
    const table = _el(tableSelector);
    if (!table) return;
    const cols = table.querySelectorAll('thead th').length || 1;
    let tbody = table.querySelector('tbody');
    if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
    tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center text-muted py-4">${msg}</td></tr>`;
  }

  function error(tableSelector, msg = 'Error al cargar datos') {
    const table = _el(tableSelector);
    if (!table) return;
    const cols = table.querySelectorAll('thead th').length || 1;
    let tbody = table.querySelector('tbody');
    if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
    tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center text-danger py-4">⚠ ${msg}</td></tr>`;
  }

  return { render, empty, error };
})();

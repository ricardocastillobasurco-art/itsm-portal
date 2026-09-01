// equipment-dashboard.js
const BASE_URL      = window.APP_URL || '';
const API_EQUIPMENT = `${BASE_URL}/api/equipment`;

let equiposTable  = null;
let searchTimeout = null;
let chartMarcas   = null;
let chartSO       = null;
let filtroActivo  = null;   // { tipo, valor }
let activeFilters = {};     // { equipment_type, estado_operativo, status }

$(document).ready(function () {
    cargarKpis();
    cargarPivot();
    cargarCharts();
    inicializarTablaEquipos();

    $('#globalSearch').on('keyup', function () {
        const term = $(this).val().trim();
        clearTimeout(searchTimeout);
        if (term.length > 0 && term.length < 2) return;
        searchTimeout = setTimeout(() => {
            if (equiposTable) equiposTable.search(term).draw();
        }, 300);
    });

    // Filtros desplegables
    $('#filterTipo, #filterEstadoOp').on('change', function () {
        activeFilters = {
            equipment_type:   $('#filterTipo').val()      || null,
            estado_operativo: $('#filterEstadoOp').val()  || null,
        };
        filtroActivo = null;
        if (equiposTable) equiposTable.ajax.reload(null, true);
    });

    $('#btnLimpiarFiltros').on('click', limpiarFiltros);
    $('#btnExportCSV').on('click', exportarCSV);
});

// ── KPIs ──────────────────────────────────────────────────────────────────
async function cargarKpis() {
    try {
        const res  = await fetch(`${API_EQUIPMENT}/kpis`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) return;
        const d = data.data;
        $('#kpiTotal').text(d.total);
        $('#kpiLaptop').text(d.laptop);
        $('#kpiDesktop').text(d.desktop);
        $('#kpiUltra').text(d.ultraligera);
        $('#kpiSinEquipo').text(d.sinEquipo);
        $('#totalEquiposTabla').text(d.total);
    } catch (e) { console.error('KPIs:', e); }
}

// ── PIVOT TABLE ───────────────────────────────────────────────────────────
async function cargarPivot() {
    const wrap = document.getElementById('pivotWrap');
    if (!wrap) return;
    try {
        const res  = await fetch(`${API_EQUIPMENT}/pivot`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) return;

        const { tree, years } = data.data;
        const tipoLabel = { Laptop: 'Portátil', Desktop: 'Desktop', Ultraligera: 'Ultraligera', Otro: 'Otro' };
        const tipoColor = { Laptop: '#3b82f6', Desktop: '#10b981', Ultraligera: '#8b5cf6', Otro: '#f59e0b' };

        let html = `<table class="pivot-table">
          <thead><tr>
            <th style="text-align:left;min-width:140px;">Tipo</th>
            <th style="text-align:left;min-width:220px;">Modelo</th>
            ${years.map(y => `<th>${y}</th>`).join('')}
            <th style="font-weight:700;">Total</th>
          </tr></thead><tbody>`;

        let grandTotal = 0;
        const grandByYear = {};

        for (const [tipo, modelos] of Object.entries(tree)) {
            const label = tipoLabel[tipo] || tipo;
            const color = tipoColor[tipo] || '#64748b';
            let tipoTotal = 0;
            const tipoByYear = {};

            const modelEntries = Object.entries(modelos);
            modelEntries.forEach(([modelo, yearMap], idx) => {
                let rowTotal = 0;
                const cells = years.map(y => {
                    const cnt = yearMap[y] || 0;
                    rowTotal += cnt;
                    tipoByYear[y] = (tipoByYear[y] || 0) + cnt;
                    return `<td>${cnt || ''}</td>`;
                }).join('');
                tipoTotal += rowTotal;

                const isFirst = idx === 0;
                html += `<tr class="pivot-row">
                  <td style="vertical-align:middle;">
                    ${isFirst ? `<span class="pivot-tipo-badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${label}</span>` : ''}
                  </td>
                  <td style="text-align:left;font-size:12px;color:var(--text-muted);">${modelo}</td>
                  ${cells}
                  <td style="font-weight:600;">${rowTotal}</td>
                </tr>`;
            });

            // Subtotal por tipo
            years.forEach(y => { grandByYear[y] = (grandByYear[y] || 0) + (tipoByYear[y] || 0); });
            grandTotal += tipoTotal;

            html += `<tr class="pivot-subtotal">
              <td></td>
              <td style="text-align:left;font-size:11px;font-weight:700;color:${color};">Subtotal ${label}</td>
              ${years.map(y => `<td style="font-weight:700;">${tipoByYear[y] || ''}</td>`).join('')}
              <td style="font-weight:700;color:${color};">${tipoTotal}</td>
            </tr>`;
        }

        // Grand total
        html += `<tr class="pivot-grand">
          <td></td>
          <td style="text-align:left;">Grand Total</td>
          ${years.map(y => `<td>${grandByYear[y] || ''}</td>`).join('')}
          <td>${grandTotal}</td>
        </tr></tbody></table>`;

        wrap.innerHTML = html;
    } catch (e) { console.error('Pivot:', e); wrap.innerHTML = '<p class="text-muted p-3">Error cargando pivot</p>'; }
}

// ── GRÁFICOS MARCAS + SO (una sola request al endpoint agregado) ──────────
async function cargarGraficoMarcas() { /* lanzado desde cargarCharts() */ }
async function cargarGraficoSO()     { /* lanzado desde cargarCharts() */ }

async function cargarCharts() {
    try {
        const res  = await fetch(`${API_EQUIPMENT}/charts`, { credentials: 'include' });
        const json = await res.json();
        if (!json.success) return;

        // ── Marcas ──────────────────────────────────────────────────────────
        const ctxM = document.getElementById('chartTopMarcas');
        if (ctxM && json.data.brands?.length) {
            const top = json.data.brands;
            if (chartMarcas) chartMarcas.destroy();
            chartMarcas = new Chart(ctxM, {
                type: 'bar',
                data: { labels: top.map(m => m.label), datasets: [{ label: 'Equipos', data: top.map(m => m.cnt), backgroundColor: '#3b82f6', borderRadius: 6, hoverBackgroundColor: '#2563eb' }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true }, y: { grid: { display: false } } },
                    onClick: (e, els) => { if (els.length) filtrarPorMarca(chartMarcas.data.labels[els[0].index]); },
                    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } }
            });
        }

        // ── SO ───────────────────────────────────────────────────────────────
        const ctxS = document.getElementById('chartTopSO');
        if (ctxS && json.data.so?.length) {
            const sorted = json.data.so;
            const colores = sorted.map(({ label: l }) => {
                const v = l.toLowerCase();
                if (v.includes('windows 11')) return '#0078d4';
                if (v.includes('windows 10')) return '#00a4ef';
                if (v.includes('windows'))    return '#357ec7';
                if (v.includes('linux') || v.includes('ubuntu')) return '#e95420';
                if (v.includes('mac'))         return '#555';
                return '#9ca3af';
            });
            if (chartSO) chartSO.destroy();
            chartSO = new Chart(ctxS, {
                type: 'doughnut',
                data: { labels: sorted.map(s => s.label), datasets: [{ data: sorted.map(s => s.cnt), backgroundColor: colores, borderWidth: 2, borderColor: '#fff', hoverOffset: 12 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
                    plugins: { legend: { position: 'bottom', labels: { padding: 8, font: { size: 10 }, generateLabels: chart => chart.data.labels.map((label, i) => ({ text: `${label} (${chart.data.datasets[0].data[i]})`, fillStyle: chart.data.datasets[0].backgroundColor[i], hidden: false, index: i })) } } },
                    onClick: (e, els) => { if (els.length) filtrarPorSO(chartSO.data.labels[els[0].index]); },
                    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } }
            });
        }
    } catch (e) { console.error('Charts:', e); }
}

// ── FILTROS ───────────────────────────────────────────────────────────────
function filtrarPorMarca(marca) {
    filtroActivo = { tipo: 'brand', valor: marca };
    if (equiposTable) equiposTable.ajax.reload(null, true);
}
function filtrarPorSO(so) {
    filtroActivo = { tipo: 'so', valor: so };
    if (equiposTable) equiposTable.ajax.reload(null, true);
}
function limpiarFiltros() {
    filtroActivo  = null;
    activeFilters = {};
    $('#filterTipo, #filterEstadoOp').val('');
    $('#globalSearch').val('');
    if (equiposTable) { equiposTable.search('').ajax.reload(null, true); }
}
function limpiarFiltroTabla() { limpiarFiltros(); }

// ── DATATABLE ─────────────────────────────────────────────────────────────
function inicializarTablaEquipos() {
    if (equiposTable) equiposTable.destroy();
    equiposTable = $('#equiposTable').DataTable({
        language: { url: '/js/es-ES.json' },
        pageLength: 25,
        processing: true,
        serverSide: true,
        ajax: {
            url: API_EQUIPMENT,
            credentials: 'include',
            data: function (d) {
                return {
                    page:              Math.floor(d.start / d.length) + 1,
                    limit:             d.length,
                    search:            d.search.value || '',
                    equipment_type:    activeFilters.equipment_type || undefined,
                    estado_operativo:   activeFilters.estado_operativo || undefined,
                    brand:             filtroActivo?.tipo === 'brand' ? filtroActivo.valor : undefined,
                    operating_system:  filtroActivo?.tipo === 'so'    ? filtroActivo.valor : undefined,
                };
            },
            // DataTables serverSide requiere recordsTotal y recordsFiltered en la raíz
            dataFilter: function (raw) {
                const json = JSON.parse(raw);
                // Mapear al formato que espera DataTables
                json.recordsTotal    = json.recordsTotal    ?? json.pagination?.totalItems ?? 0;
                json.recordsFiltered = json.recordsFiltered ?? json.pagination?.totalItems ?? 0;
                $('#totalEquiposTabla').text(json.recordsFiltered);
                return JSON.stringify(json);
            },
            dataSrc: 'data',
        },
        columns: [
            { data: 'device_code',    render: d => `<strong style="font-family:monospace;font-size:12px;">${d || '—'}</strong>` },
            { data: 'equipment_type', render: d => {
                const c = { Laptop: '#3b82f6', Desktop: '#10b981', Ultraligera: '#8b5cf6', Otro: '#f59e0b' };
                const bg = c[d] || '#94a3b8';
                return `<span style="background:${bg}20;color:${bg};border:1px solid ${bg}40;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:600;">${d || '—'}</span>`;
            }},
            { data: 'brand', render: d => `<strong>${d || '—'}</strong>` },
            { data: 'model', render: d => `<span style="color:var(--text-muted);font-size:12px;">${d || '—'}</span>` },
            { data: 'status', render: (d, type, row) => {
                const label = d === 'En Reparación' ? 'Dañado' : (d || '—');
                const c = { Asignado: '#10b981', Disponible: '#3b82f6', 'En Reparación': '#f59e0b', 'Dado de Baja': '#6b7280', 'En Tránsito': '#8b5cf6' };
                const bg = c[d] || '#94a3b8';
                let extra = '';
                if (row.is_stolen == 1)
                    extra = `<span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:700;margin-left:5px;"><i class="bi bi-shield-exclamation"></i> ROBADO</span>`;
                else if (row.active_loan_id)
                    extra = `<span style="background:#fef3c720;color:#d97706;border:1px solid #fcd34d;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:700;margin-left:5px;"><i class="bi bi-arrow-left-right"></i> Prestado</span>`;
                return `<span style="background:${bg}20;color:${bg};border:1px solid ${bg}40;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:600;">${label}</span>${extra}`;
            }},
            { data: 'assigned_to', orderable: false, render: (d, type, row) => {
                if (d) {
                    const cip = row.assigned_cip ? `<div style="font-size:10px;color:var(--text-muted);">CIP: ${d}</div>` : '';
                    return `<div style="font-size:12px;font-weight:600;color:#059669;">${d}</div>${cip ? `<div style="font-size:10px;color:var(--text-muted);">CIP: ${row.assigned_cip}</div>` : ''}`;
                }
                return `<span style="color:#94a3b8;font-size:11px;">— Disponible</span>`;
            }},
            { data: null, orderable: false, render: (d, type, row) => {
                const stolen = row.is_stolen == 1 ? `<i class="bi bi-shield-exclamation text-danger me-1" title="Robado"></i>` : '';
                return `${stolen}<button class="btn btn-sm btn-outline-primary detalles-btn" style="padding:4px 12px;font-size:11px;"><i class="bi bi-info-circle me-1"></i>Detalles</button>`;
            }}
        ],
        order: [[0, 'asc']]
    });

    $('#equiposTable').off('click', '.detalles-btn').on('click', '.detalles-btn', function () {
        const row = equiposTable.row($(this).parents('tr')).data();
        if (row) openDetallesModal(row.device_code);
    });
}

// ── EXPORT CSV ────────────────────────────────────────────────────────────
async function exportarCSV() {
    const btn = document.getElementById('btnExportCSV');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Exportando...'; }
    try {
        const res  = await fetch(`${API_EQUIPMENT}?limit=9999`, { credentials: 'include' });
        const data = await res.json();
        const rows = data.data || [];
        const cols = ['device_code', 'equipment_type', 'brand', 'model', 'obsolescence_years', 'serial_number', 'processor', 'operating_system', 'ram_memory', 'disk_capacity', 'acquisition_type', 'status'];
        const header = ['Código', 'Tipo', 'Marca', 'Modelo', 'Año', 'Serie', 'Procesador', 'SO', 'RAM', 'Disco', 'Adquisición', 'Estado'];
        const csv = [header.join(','), ...rows.map(r => cols.map(c => `"${(r[c] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `equipos_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
    } catch (e) { alert('Error al exportar: ' + e.message); }
    finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-download"></i> Exportar CSV'; }
    }
}

// ── MODAL DETALLES ────────────────────────────────────────────────────────

const _estadoColors = {
    'Asignado':      { bg: '#10b981', label: 'Asignado' },
    'Disponible':    { bg: '#3b82f6', label: 'Disponible' },
    'Dañado':        { bg: '#f59e0b', label: 'Dañado' },
    'En Reparación': { bg: '#f59e0b', label: 'Dañado' },
    'En tránsito':   { bg: '#8b5cf6', label: 'En tránsito' },
    'En Tránsito':   { bg: '#8b5cf6', label: 'En tránsito' },
    'Por recuperar': { bg: '#ef4444', label: 'Por recuperar' },
    'Prestado':      { bg: '#d97706', label: 'Prestado' },
    'Robado':        { bg: '#dc2626', label: 'Robado' },
    'Dado de Baja':  { bg: '#6b7280', label: 'Dado de baja' },
};

function _badge(estado) {
    const e = _estadoColors[estado] || { bg: '#94a3b8', label: estado };
    return `<span style="background:${e.bg}20;color:${e.bg};border:1px solid ${e.bg}50;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:700;">${e.label}</span>`;
}

function _ro(label, val) {
    return `<div class="col-md-4 mb-2">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:3px;">${label}</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-main);">${val || '—'}</div>
    </div>`;
}

async function openDetallesModal(device_code) {
    const modal = document.getElementById('detallesModal');
    const body  = document.getElementById('detallesBody');
    body.innerHTML = '<div class="text-center py-4"><span class="spinner-border spinner-border-sm me-2"></span>Cargando...</div>';
    new bootstrap.Modal(modal).show();

    try {
        const res  = await fetch(`${API_EQUIPMENT}/${encodeURIComponent(device_code)}/details`, { credentials: 'include' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Error');
        const d = json.data;
        const eo = d.estado_operativo;

        let extraHtml = '';

        if (d.falla) {
            extraHtml += `<div class="mt-3 p-3" style="border-radius:8px;border:1.5px solid #fcd34d;background:#fffbeb;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#92400e;margin-bottom:8px;"><i class="bi bi-tools me-1"></i>Falla técnica registrada</div>
                <div class="row"><div class="col-md-6"><b>Componente:</b> ${d.falla.component || '—'}</div><div class="col-md-6"><b>Estado reparación:</b> ${d.falla.repair_status || '—'}</div></div>
                <div class="mt-2"><b>Descripción:</b> ${d.falla.description || '—'}</div>
            </div>`;
        }
        if (d.recovery) {
            extraHtml += `<div class="mt-3 p-3" style="border-radius:8px;border:1.5px solid #fca5a5;background:#fff5f5;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#991b1b;margin-bottom:8px;"><i class="bi bi-arrow-counterclockwise me-1"></i>Recupero activo</div>
                <div class="row"><div class="col-md-6"><b>Método:</b> ${d.recovery.recovery_method || '—'}</div><div class="col-md-6"><b>Técnico:</b> ${d.recovery.technician_name || '—'}</div></div>
                ${d.recovery.scheduled_date ? `<div class="mt-1"><b>Fecha programada:</b> ${d.recovery.scheduled_date.slice(0,10)}</div>` : ''}
            </div>`;
        }
        if (d.loan) {
            extraHtml += `<div class="mt-3 p-3" style="border-radius:8px;border:1.5px solid #fcd34d;background:#fffbeb;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#92400e;margin-bottom:8px;"><i class="bi bi-arrow-left-right me-1"></i>Préstamo activo</div>
                <div class="row">
                    <div class="col-md-6"><b>Prestado a:</b> ${d.loan.prestado_a}</div>
                    <div class="col-md-6"><b>Hasta:</b> ${d.loan.prestado_hasta ? d.loan.prestado_hasta.slice(0,10) : '—'}</div>
                </div>
                <button class="btn btn-sm btn-outline-danger mt-2" onclick="devolverEquipo(${d.loan.id},'${device_code}')"><i class="bi bi-box-arrow-in-left me-1"></i>Marcar como devuelto</button>
            </div>`;
        }
        if (d.last_transfer && eo === 'En tránsito') {
            const t = d.last_transfer;
            extraHtml += `<div class="mt-3 p-3" style="border-radius:8px;border:1.5px solid #a5b4fc;background:#eef2ff;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#3730a3;margin-bottom:8px;"><i class="bi bi-truck me-1"></i>Último traslado</div>
                <div class="row">
                    <div class="col-md-6"><b>Origen:</b> ${t.origin_name || '—'} ${t.origin_city ? '('+t.origin_city+')' : ''}</div>
                    <div class="col-md-6"><b>Destino:</b> ${t.destination_name || '—'} ${t.destination_city ? '('+t.destination_city+')' : ''}</div>
                </div>
            </div>`;
        }

        const canLoan = !d.loan && d.is_stolen != 1 && !d.recovery;
        const loanForm = canLoan ? `
            <div class="mt-3 p-3" style="border-radius:8px;border:1.5px solid var(--border-soft);background:var(--bg-header);">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;"><i class="bi bi-arrow-left-right me-1"></i>Registrar préstamo</div>
                <div class="row g-2">
                    <div class="col-md-5">
                        <label style="font-size:11px;font-weight:600;">Prestado a *</label>
                        <input type="text" id="loanPrestadoA" class="form-control form-control-sm" placeholder="Buscar colaborador..." autocomplete="off" list="loanEmpList">
                        <datalist id="loanEmpList"></datalist>
                    </div>
                    <div class="col-md-3">
                        <label style="font-size:11px;font-weight:600;">Desde</label>
                        <input type="date" id="loanDesde" class="form-control form-control-sm" value="${new Date().toISOString().slice(0,10)}">
                    </div>
                    <div class="col-md-4">
                        <label style="font-size:11px;font-weight:600;">Hasta *</label>
                        <input type="date" id="loanHasta" class="form-control form-control-sm">
                    </div>
                </div>
                <button class="btn btn-sm btn-primary mt-2" onclick="crearPrestamo('${device_code}')"><i class="bi bi-check2 me-1"></i>Registrar préstamo</button>
            </div>` : '';

        body.innerHTML = `
            <div class="d-flex align-items-center gap-3 mb-3">
                <div>
                    <div style="font-family:monospace;font-size:16px;font-weight:800;">${d.device_code}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${d.brand || ''} ${d.model || ''}</div>
                </div>
                <div class="ms-auto">${_badge(eo)}</div>
            </div>
            <div class="row">
                ${_ro('Serie', d.serial_number)}
                ${_ro('Tipo', d.equipment_type)}
                ${_ro('Año', d.obsolescence_years)}
                ${_ro('Procesador', d.processor)}
                ${_ro('RAM', d.ram_memory)}
                ${_ro('Disco', d.disk_capacity)}
                ${_ro('SO', d.operating_system)}
            </div>
            ${d.assigned_to ? `<div class="p-2 mt-1 mb-1" style="border-radius:8px;border:1px solid var(--border-soft);background:var(--bg-header);">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;"><i class="bi bi-person-fill me-1"></i>Usuario asignado</div>
                <div style="font-size:13px;font-weight:600;">${d.assigned_to.nombre}</div>
                <div style="font-size:11px;color:var(--text-muted);">${d.assigned_to.department || ''} ${d.assigned_to.email ? '· '+d.assigned_to.email : ''}</div>
            </div>` : ''}
            ${extraHtml}
            ${loanForm}`;

        if (canLoan) {
            document.getElementById('loanPrestadoA').addEventListener('input', async function() {
                const q = this.value.trim();
                if (q.length < 2) return;
                try {
                    const r = await fetch(`${BASE_URL}/api/employees/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
                    const j = await r.json();
                    const dl = document.getElementById('loanEmpList');
                    if (dl) {
                        dl.innerHTML = '';
                        const items = j.data || j || [];
                        items.slice(0, 10).forEach(e => {
                            const opt = document.createElement('option');
                            opt.value = e.full_name || e.nombre || e.name || '';
                            dl.appendChild(opt);
                        });
                    }
                } catch (_) {}
            });
        }
    } catch (e) {
        body.innerHTML = `<div class="alert alert-danger">Error al cargar detalles: ${e.message}</div>`;
    }
}

async function crearPrestamo(device_code) {
    const prestado_a  = document.getElementById('loanPrestadoA')?.value.trim();
    const desde       = document.getElementById('loanDesde')?.value;
    const hasta       = document.getElementById('loanHasta')?.value;
    if (!prestado_a || !hasta) { alert('Completa los campos obligatorios.'); return; }
    try {
        const res = await fetch(`${API_EQUIPMENT}/loans`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ device_code, prestado_a, prestado_desde: desde, prestado_hasta: hasta }),
        });
        const j = await res.json();
        if (j.success) {
            if (equiposTable) equiposTable.ajax.reload(null, false);
            openDetallesModal(device_code);
        } else { alert('Error: ' + (j.error || j.message)); }
    } catch (e) { alert('Error: ' + e.message); }
}

async function devolverEquipo(loanId, device_code) {
    if (!confirm('¿Confirmar devolución del equipo?')) return;
    try {
        const res = await fetch(`${API_EQUIPMENT}/loans/${loanId}/return`, {
            method: 'PUT', credentials: 'include',
        });
        const j = await res.json();
        if (j.success) {
            if (equiposTable) equiposTable.ajax.reload(null, false);
            openDetallesModal(device_code);
        } else { alert('Error: ' + (j.error || j.message)); }
    } catch (e) { alert('Error: ' + e.message); }
}

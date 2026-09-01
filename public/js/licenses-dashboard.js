'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────
function toggleTheme() {
  const h = document.documentElement, c = h.getAttribute('data-theme'), n = c === 'dark' ? 'light' : 'dark';
  h.setAttribute('data-theme', n); localStorage.setItem('dashboardTheme', n);
}

function toast(msg, type = 'inf') {
  const b = document.getElementById('toastBox'), d = document.createElement('div');
  d.className = `t-item t-${type}`;
  d.innerHTML = `<span>${{ ok: '✓', err: '✗', inf: 'ℹ' }[type] || 'ℹ'}</span><span>${msg}</span>`;
  b.appendChild(d); setTimeout(() => d.remove(), 4000);
}
function fmtMoney(v) { return v == null ? '—' : '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } }
function fmtGB(gb) { return gb >= 1 ? gb.toFixed(2) + ' GB' : (gb * 1024).toFixed(0) + ' MB'; }
function pct(a, b) { return b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0; }
function pctColor(p) { return p >= 80 ? 'var(--success)' : p >= 50 ? 'var(--warning)' : 'var(--danger)'; }
function statusBadge(s) {
  const m = { 'ACTIVO': 'badge-ok', 'BAJO USO': 'badge-warn', 'INACTIVO': 'badge-bad', 'SIN USO': 'badge-muted' };
  return `<span class="badge ${m[s] || 'badge-muted'}">${s || '—'}</span>`;
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Tabs ──────────────────────────────────────────────────────────────────────
const _loaded = {};
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (!_loaded[name]) { _loaded[name] = true; loadTab(name); }
}
function loadTab(t) {
  if (t === 'usuarios')   loadUsers(1);
  if (t === 'areas')      loadDepts();
  if (t === 'recom')      loadRecom();
  if (t === 'historico')  loadHistory();
  if (t === 'grupos')     loadGroups();
  if (t === 'sharepoint') loadSP();
  if (t === 'alertas')    loadAlerts();
  if (t === 'usoapps')    loadLicReports();
  if (t === 'tendencias') loadLicTrends();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-ov').forEach(m => m.addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('open');
}));

// ── Sync ──────────────────────────────────────────────────────────────────────
let _syncTimer = null;
async function startSync() {
  const btn = document.getElementById('btnSync');
  btn.disabled = true;
  try {
    const j = await AppAPI.raw('/api/licenses/sync', { method: 'POST' });
    if (!j.success && j.message !== 'Sync ya en progreso') { toast(j.message, 'err'); btn.disabled = false; return; }
    toast('Sync iniciado — esto puede tardar unos minutos', 'inf');
    pollSync();
  } catch (e) { toast('Error: ' + e.message, 'err'); btn.disabled = false; }
}

function pollSync() {
  clearInterval(_syncTimer);
  _syncTimer = setInterval(async () => {
    try {
      const j = await AppAPI.raw('/api/licenses/sync-status');
      const s = j.sync;
      const dot = document.getElementById('syncDot');
      const msg = document.getElementById('syncMsg');
      const sub = document.getElementById('syncSub');
      const bar = document.getElementById('syncBar');
      const barWrap = document.getElementById('syncBarWrap');
      const btnSync = document.getElementById('btnSync');

      if (s.running) {
        dot.className = 'sync-dot running';
        msg.textContent = s.message || 'Sincronizando...';
        sub.textContent = `Progreso: ${s.progress || 0}%`;
        barWrap.style.display = 'block';
        bar.style.width = (s.progress || 0) + '%';
      } else {
        clearInterval(_syncTimer);
        btnSync.disabled = false;
        if (s.error) {
          dot.className = 'sync-dot err';
          msg.textContent = 'Error: ' + s.error;
          sub.textContent = 'Revisa la configuración de Azure AD';
          toast('Sync falló: ' + s.error, 'err');
        } else {
          dot.className = 'sync-dot ok';
          msg.textContent = s.message || 'Sincronización completada';
          sub.textContent = s.lastRun ? 'Último sync: ' + new Date(s.lastRun).toLocaleString('es-PE') : '';
          barWrap.style.display = 'none';
          toast('Sync completado — recargando datos', 'ok');
          Object.keys(_loaded).forEach(k => { _loaded[k] = false; });
          await loadOverview();
          const activeTab = document.querySelector('.tab-panel.active');
          if (activeTab) { const name = activeTab.id.replace('tab-', ''); _loaded[name] = true; loadTab(name); }
        }
      }
    } catch { /* poll silently */ }
  }, 2500);
}

// ── Overview (KPIs + SKU table) ───────────────────────────────────────────────
let _costChart = null;
async function loadOverview() {
  try {
    const j = await AppAPI.raw('/api/licenses/overview');
    if (!j.success) throw new Error(j.message);
    const d = j.data;
    const usoPct = pct(d.totalConsumed, d.totalConsumed + (d.totalAvailable || 0));

    // Usuarios activos y Grupos desde MS Graph (no-fatal si falla)
    let msUsers = null, msGroups = null;
    try {
      const ms = await AppAPI.raw('/api/ms/dashboard');
      if (ms.success) { msUsers = ms.data?.users ?? null; msGroups = ms.data?.groups ?? null; }
    } catch { /* MS no conectado — se muestra "—" */ }

    document.getElementById('kpiRow').innerHTML = `
      <div class="kpi"><div class="kpi-lbl">Usuarios activos</div>
        <div class="kpi-val cb">${msUsers !== null ? msUsers.toLocaleString() : '—'}</div>
        <div class="kpi-sub">Entra ID habilitados</div><i class="bi bi-people-fill kpi-ico cb"></i></div>
      <div class="kpi"><div class="kpi-lbl">Grupos</div>
        <div class="kpi-val cp">${msGroups !== null ? msGroups.toLocaleString() : '—'}</div>
        <div class="kpi-sub">Seguridad + M365</div><i class="bi bi-diagram-3-fill kpi-ico cp"></i></div>
      <div class="kpi"><div class="kpi-lbl">Licencias consumidas</div>
        <div class="kpi-val cb">${(d.totalConsumed || 0).toLocaleString()}</div>
        <div class="kpi-sub">de ${((d.totalConsumed || 0) + (d.totalAvailable || 0)).toLocaleString()} totales · ${usoPct}%</div><i class="bi bi-key-fill kpi-ico cb"></i></div>
      <div class="kpi kpi-warn"><div class="kpi-lbl">Sin uso / Inactivos</div>
        <div class="kpi-val cr">${(d.inactiveUsers || 0).toLocaleString()}</div>
        <div class="kpi-sub">de ${(d.totalUsers || 0).toLocaleString()} usuarios totales</div><i class="bi bi-person-x-fill kpi-ico cr"></i></div>
      <div class="kpi"><div class="kpi-lbl">Costo por usuario activo</div>
        <div class="kpi-val ca" style="font-size:20px;">${fmtMoney(d.costPerActive)}</div>
        <div class="kpi-sub">/mes entre ${(d.activeCount || 0).toLocaleString()} usuarios activos</div><i class="bi bi-person-check-fill kpi-ico ca"></i></div>
      <div class="kpi"><div class="kpi-lbl">Último sync</div>
        <div class="kpi-val" style="font-size:13px;margin-top:8px;">${d.lastSync ? new Date(d.lastSync).toLocaleDateString('es-PE') : '—'}</div>
        <div class="kpi-sub">${d.lastSync ? new Date(d.lastSync).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : 'Sin datos aún'}</div><i class="bi bi-clock-fill kpi-ico"></i></div>
    `;

    const skus = d.skus || [];
    document.getElementById('skuBody').innerHTML = skus.length ? skus.map(s => {
      const p = pct(s.consumed || 0, s.total || 1);
      const col = pctColor(p);
      return `<tr>
        <td><div style="font-weight:700;font-size:12px;">${s.sku_name || '—'}</div>
            <div class="mono" style="color:var(--muted);font-size:10px;">${s.label || ''}</div></td>
        <td style="text-align:center;font-family:var(--mono);">${(s.total || 0).toLocaleString()}</td>
        <td style="text-align:center;font-family:var(--mono);color:var(--danger);">${(s.consumed || 0).toLocaleString()}</td>
        <td style="text-align:center;font-family:var(--mono);color:var(--success);">${(s.available || 0).toLocaleString()}</td>
        <td style="min-width:90px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div class="pbar-wrap" style="flex:1;"><div class="pbar-fill" style="width:${p}%;background:${col};"></div></div>
            <span style="font-size:10px;font-weight:700;color:${col};min-width:28px;">${p}%</span>
          </div>
        </td>
        <td style="text-align:right;font-weight:700;font-family:var(--mono);color:var(--success);">${s.cost_monthly ? '$' + parseFloat(s.cost_monthly).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty"><i class="bi bi-cloud-slash"></i>Sin datos — realiza un sync primero</td></tr>`;

    document.getElementById('savingsHero').textContent = fmtMoney(d.savingsPotential) + '/mes';
    document.getElementById('savingsSub').textContent = `${d.inactiveUsers || 0} usuarios sin actividad detectada`;

    const colored = ['#3b82f6', '#0052CC', '#172B4D', '#F2C811', '#e0a800', '#106ebe', '#31752f', '#742774', '#0066FF', '#5c2d91'];
    if (_costChart) _costChart.destroy();
    const cSkus = skus.filter(s => parseFloat(s.cost_monthly) > 0);
    if (cSkus.length) {
      _costChart = new Chart(document.getElementById('costChart'), {
        type: 'doughnut',
        data: {
          labels: cSkus.map(s => s.label || s.sku_name),
          datasets: [{ data: cSkus.map(s => parseFloat(s.cost_monthly) || 0), backgroundColor: colored.slice(0, cSkus.length), borderWidth: 2, borderColor: 'var(--card)' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 6, boxWidth: 10 } }, tooltip: { callbacks: { label: c => ' ' + c.label + ': $' + c.raw.toLocaleString('en-US', { minimumFractionDigits: 0 }) } } }
        }
      });
    }

    if (d.lastSync) {
      document.getElementById('syncDot').className = 'sync-dot ok';
      document.getElementById('syncMsg').textContent = 'Datos sincronizados correctamente';
      document.getElementById('syncSub').textContent = 'Último sync: ' + new Date(d.lastSync).toLocaleString('es-PE');
    }
  } catch (e) {
    if (e.message && !e.message.includes('Failed')) {
      document.getElementById('syncMsg').textContent = 'Sin datos — realiza una sincronización';
      document.getElementById('syncSub').textContent = 'Conecta con Azure para obtener datos de licencias';
    }
  }
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
let _userDebounce = null, _costMapLocal = {};
async function loadUsers(page = 1) {
  const q       = document.getElementById('userQ').value;
  const dept    = document.getElementById('userDept').value;
  const group   = document.getElementById('userGroup').value;
  const status  = document.getElementById('userStatus').value;
  const inactive = document.getElementById('userInactive').value;
  const params  = new URLSearchParams({ q, dept, group, status, inactive, page, limit: 60 });
  const tbody   = document.getElementById('usersBody');
  tbody.innerHTML = `<tr><td colspan="10" class="empty"><div class="skel" style="height:12px;width:200px;margin:0 auto;"></div></td></tr>`;
  try {
    const j = await AppAPI.raw(`/api/licenses/users?${params}`);
    if (!j.success) throw new Error(j.message);
    const rows = j.data || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty"><i class="bi bi-people"></i>Sin resultados</td></tr>`;
      document.getElementById('usersPagInfo').textContent = '0 usuarios';
      document.getElementById('usersPag').innerHTML = '';
      return;
    }
    tbody.innerHTML = rows.map(u => {
      const grps = (u.license_groups || []);
      const skuMap = { 'M365 E1': 'STANDARDPACK', 'M365 E3': 'ENTERPRISEPACK', 'M365 E5': 'SPE_E5', 'Power BI Pro': 'POWER_BI_PRO', 'Power BI Premium': 'PBI_PREMIUM_PER_USER', 'Visio P2': 'VISIOONLINE_PLAN2', 'Project P3': 'PROJECTPREMIUM', 'Power Apps Premium': 'POWERAPPS_PER_USER', 'Power Automate': 'FLOW_PER_USER', 'M365 EOP1': 'EOP_ENTERPRISE_PREMIUM_P1' };
      const cost = grps.reduce((s, g) => s + (_costMapLocal[skuMap[g]] || 0), 0);
      const dias = u.days_inactive != null ? u.days_inactive : '—';
      const diasBadge = u.days_inactive == null ? 'badge-muted' : u.days_inactive <= 30 ? 'badge-ok' : u.days_inactive <= 60 ? 'badge-warn' : 'badge-bad';
      return `<tr>
        <td><div style="font-weight:600;font-size:12px;">${esc(u.display_name || '—')}</div>
            <div class="mono" style="color:var(--muted);">${esc(u.email || u.upn || '')}</div></td>
        <td style="font-size:12px;color:var(--muted);">${esc(u.department || '—')}</td>
        <td style="font-size:11px;">${grps.map(g => `<span class="badge badge-blue" style="margin:1px;">${g}</span>`).join('') || '—'}</td>
        <td style="text-align:center;font-size:12px;">${fmtDate(u.last_activity_date)}</td>
        <td style="text-align:center;"><span class="badge ${diasBadge}">${dias}d</span></td>
        <td style="text-align:center;"><span class="badge ${u.activo_30d ? 'badge-ok' : 'badge-muted'}">${u.activo_30d ? 'Sí' : 'No'}</span></td>
        <td style="text-align:center;"><span class="badge ${u.activo_60d ? 'badge-ok' : 'badge-muted'}">${u.activo_60d ? 'Sí' : 'No'}</span></td>
        <td style="text-align:center;"><span class="badge ${u.activo_90d ? 'badge-ok' : 'badge-muted'}">${u.activo_90d ? 'Sí' : 'No'}</span></td>
        <td style="text-align:center;">${statusBadge(u.activity_status)}</td>
        <td style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--muted);">${cost > 0 ? '$' + cost.toFixed(0) : '—'}</td>
      </tr>`;
    }).join('');
    document.getElementById('usersPagInfo').textContent = `${j.total.toLocaleString()} usuarios · página ${j.page}/${j.pages}`;
    renderPagination('usersPag', j.page, j.pages, loadUsers);
  } catch (e) { tbody.innerHTML = `<tr><td colspan="10" style="color:var(--danger);padding:20px;text-align:center;">${e.message}</td></tr>`; }
}
function debounceUsers() { clearTimeout(_userDebounce); _userDebounce = setTimeout(() => loadUsers(1), 400); }

function renderPagination(id, page, pages, fn) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  if (pages <= 1) { wrap.innerHTML = ''; return; }
  const btns = [];
  btns.push(`<button class="page-btn" onclick="(${fn.name})(1)" ${page === 1 ? 'disabled' : ''}>«</button>`);
  btns.push(`<button class="page-btn" onclick="(${fn.name})(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>`);
  const start = Math.max(1, page - 2), end = Math.min(pages, page + 2);
  for (let i = start; i <= end; i++) btns.push(`<button class="page-btn ${i === page ? 'active' : ''}" onclick="(${fn.name})(${i})">${i}</button>`);
  btns.push(`<button class="page-btn" onclick="(${fn.name})(${page + 1})" ${page === pages ? 'disabled' : ''}>›</button>`);
  btns.push(`<button class="page-btn" onclick="(${fn.name})(${pages})" ${page === pages ? 'disabled' : ''}>»</button>`);
  wrap.innerHTML = btns.join('');
}

// ── Dirección — Drill-down ────────────────────────────────────────────────────
let _dirLevel = 0, _selDir = null, _selArea = null;
let _dirInactChart = null, _dirStatusChart = null;
let _dirUsrDebTimer = null;

async function loadDepts() {
  _dirLevel = 0; _selDir = null; _selArea = null;
  document.getElementById('dirLevel0').style.display = '';
  document.getElementById('dirLevel1').style.display = 'none';
  document.getElementById('dirLevel2').style.display = 'none';
  document.getElementById('dirKpiRow').style.display = 'none';
  setBreadcrumb(0);
  const grid = document.getElementById('dirGrid');
  grid.innerHTML = '<div class="skel" style="height:130px;border-radius:12px;"></div>'.repeat(6);
  try {
    const j = await AppAPI.raw('/api/licenses/direcciones');
    if (!j.success) throw new Error(j.message);
    const dirs = j.data || [];
    if (!dirs.length) { grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--muted);"><i class="bi bi-diagram-3" style="font-size:40px;"></i><br>Sin datos — realiza una sincronización primero</div>`; return; }
    grid.innerHTML = dirs.map(d => dirCard(d)).join('');
  } catch (e) { grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--danger);text-align:center;">${esc(e.message)}</div>`; }
}

function dirCard(d) {
  const col = pctColor(d.uso_pct), usados = d.activos + d.bajo_uso;
  return `<div class="dir-card" onclick="drillDir(1,'${escJs(d.dir)}')">
    <div class="dir-card-name"><i class="bi bi-building-fill" style="color:var(--primary);font-size:16px;"></i>${esc(d.dir)}</div>
    <div class="dir-card-kpis">
      <div class="dir-kpi"><div class="dir-kpi-val cg">${d.activos}</div><div class="dir-kpi-lbl">Activos</div></div>
      <div class="dir-kpi"><div class="dir-kpi-val ca">${d.bajo_uso}</div><div class="dir-kpi-lbl">Bajo uso</div></div>
      <div class="dir-kpi"><div class="dir-kpi-val cr">${d.sin_uso}</div><div class="dir-kpi-lbl">Sin uso</div></div>
      <div class="dir-kpi"><div class="dir-kpi-val cb">${d.areas_count}</div><div class="dir-kpi-lbl">Áreas</div></div>
    </div>
    <div class="dir-pbar"><div class="dir-pbar-fill" style="width:${d.uso_pct}%;background:${col};"></div></div>
    <div class="dir-card-footer">
      <span>${d.uso_pct}% uso (${usados}/${d.total})</span>
      <span class="cost">${d.cost_monthly > 0 ? fmtMoney(d.cost_monthly) + '/mes' : '—'}</span>
    </div>
    <i class="bi bi-chevron-right arrow"></i>
  </div>`;
}

function areaCard(d, dir) {
  const col = pctColor(d.uso_pct), usados = d.activos + d.bajo_uso;
  return `<div class="dir-card" onclick="drillDir(2,'${escJs(dir)}','${escJs(d.area)}')">
    <div class="dir-card-name"><i class="bi bi-people-fill" style="color:var(--info);font-size:16px;"></i>${esc(d.area)}</div>
    <div class="dir-card-kpis">
      <div class="dir-kpi"><div class="dir-kpi-val cg">${d.activos}</div><div class="dir-kpi-lbl">Activos</div></div>
      <div class="dir-kpi"><div class="dir-kpi-val ca">${d.bajo_uso}</div><div class="dir-kpi-lbl">Bajo uso</div></div>
      <div class="dir-kpi"><div class="dir-kpi-val cr">${d.sin_uso}</div><div class="dir-kpi-lbl">Sin uso</div></div>
      <div class="dir-kpi"><div class="dir-kpi-val cp">${d.total}</div><div class="dir-kpi-lbl">Total</div></div>
    </div>
    <div class="dir-pbar"><div class="dir-pbar-fill" style="width:${d.uso_pct}%;background:${col};"></div></div>
    <div class="dir-card-footer">
      <span>${d.uso_pct}% uso · ${usados}/${d.total}</span>
      <span class="cost">${d.cost_monthly > 0 ? fmtMoney(d.cost_monthly) + '/mes' : '—'}</span>
    </div>
    <i class="bi bi-chevron-right arrow"></i>
  </div>`;
}

async function drillDir(level, dir, area) {
  _dirLevel = level; _selDir = dir || null; _selArea = area || null;
  document.getElementById('dirLevel0').style.display = level === 0 ? '' : 'none';
  document.getElementById('dirLevel1').style.display = level === 1 ? '' : 'none';
  document.getElementById('dirLevel2').style.display = level === 2 ? 'flex' : 'none';
  document.getElementById('dirKpiRow').style.display = level === 0 ? 'none' : '';
  setBreadcrumb(level);
  if (level === 1) await loadAreaCards(dir);
  if (level === 2) { populateGroupFilter(); loadDirUsers(1); renderDirCharts([]); }
}

async function loadAreaCards(dir) {
  const grid = document.getElementById('areaGrid');
  grid.innerHTML = '<div class="skel" style="height:130px;border-radius:12px;"></div>'.repeat(6);
  const j = await AppAPI.raw(`/api/licenses/direccion-areas?dir=${encodeURIComponent(dir)}`);
  if (!j.success) { grid.innerHTML = `<div style="grid-column:1/-1;color:var(--danger);padding:20px;">${esc(j.message)}</div>`; return; }
  const areas = j.data || [];
  if (!areas.length) { grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--muted);">Sin áreas registradas</div>`; return; }
  grid.innerHTML = areas.map(a => areaCard(a, dir)).join('');
  const tot = areas.reduce((s, a) => s + a.total, 0), act = areas.reduce((s, a) => s + a.activos, 0),
    sin = areas.reduce((s, a) => s + a.sin_uso, 0), cost = areas.reduce((s, a) => s + a.cost_monthly, 0);
  document.getElementById('dirKpiRow').innerHTML = `
    <div class="kpi"><div class="kpi-lbl">Total usuarios</div><div class="kpi-val cb">${tot}</div><i class="bi bi-people-fill kpi-ico cb"></i></div>
    <div class="kpi"><div class="kpi-lbl">Activos</div><div class="kpi-val cg">${act}</div><div class="kpi-sub">${pct(act, tot)}% uso</div><i class="bi bi-check-circle-fill kpi-ico cg"></i></div>
    <div class="kpi"><div class="kpi-lbl">Sin uso / inactivos</div><div class="kpi-val cr">${sin}</div><i class="bi bi-slash-circle-fill kpi-ico cr"></i></div>
    <div class="kpi kpi-savings"><div class="kpi-lbl">Costo mensual</div><div class="kpi-val cg">${fmtMoney(cost)}</div><i class="bi bi-currency-dollar kpi-ico cg"></i></div>`;
}

let _grpFilterDone = false;
function populateGroupFilter() {
  if (_grpFilterDone) return; _grpFilterDone = true;
  const sel = document.getElementById('dirUsrGroup');
  ['M365 E1', 'M365 E3', 'M365 E5', 'Power BI Pro', 'Power BI Premium', 'Visio P2', 'Project P3', 'Power Apps Premium', 'Power Automate', 'M365 EOP1']
    .forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
}

function debDirQ() { clearTimeout(_dirUsrDebTimer); _dirUsrDebTimer = setTimeout(() => loadDirUsers(1), 350); }

async function loadDirUsers(page = 1) {
  const status  = document.getElementById('dirUsrStatus').value;
  const group   = document.getElementById('dirUsrGroup').value;
  const inactive = document.getElementById('dirUsrInactive').value;
  const q       = document.getElementById('dirUsrQ').value.trim();
  const params  = new URLSearchParams({ page, limit: 50 });
  if (_selArea && _selArea !== 'Sin área') params.set('dept', _selArea);
  if (_selDir)   params.set('dir', _selDir);
  if (status)    params.set('status', status);
  if (group)     params.set('group', group);
  if (inactive)  params.set('inactive', inactive);
  if (q)         params.set('q', q);
  const tbody = document.getElementById('dirUsrBody');
  tbody.innerHTML = `<tr><td colspan="7" class="empty"><i class="bi bi-hourglass-split"></i> Cargando...</td></tr>`;
  try {
    const j = await AppAPI.raw(`/api/licenses/users?${params}`);
    if (!j.success) throw new Error(j.message);
    const rows = j.data || [];
    document.getElementById('dirUsrCount').textContent = `${j.total} usuarios`;
    const act = rows.filter(u => u.activity_status === 'ACTIVO').length;
    const sin = rows.filter(u => u.activity_status === 'SIN USO').length;
    document.getElementById('dirKpiRow').innerHTML = `
      <div class="kpi"><div class="kpi-lbl">Total en área</div><div class="kpi-val cb">${j.total}</div><i class="bi bi-people-fill kpi-ico cb"></i></div>
      <div class="kpi"><div class="kpi-lbl">Activos en vista</div><div class="kpi-val cg">${act}</div><div class="kpi-sub">${pct(act, rows.length)}%</div><i class="bi bi-check-circle-fill kpi-ico cg"></i></div>
      <div class="kpi"><div class="kpi-lbl">Sin uso en vista</div><div class="kpi-val cr">${sin}</div><i class="bi bi-slash-circle-fill kpi-ico cr"></i></div>
      <div class="kpi"><div class="kpi-lbl">Dirección / Área</div><div class="kpi-val" style="font-size:12px;letter-spacing:0;">${esc(_selArea || _selDir || '—')}</div></div>`;
    renderDirCharts(rows);
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty"><i class="bi bi-inbox"></i> Sin usuarios</td></tr>`; return; }
    const sk = { 'M365 E1': 'STANDARDPACK', 'M365 E3': 'ENTERPRISEPACK', 'M365 E5': 'SPE_E5', 'Power BI Pro': 'POWER_BI_PRO', 'Power BI Premium': 'PBI_PREMIUM_PER_USER', 'Visio P2': 'VISIOONLINE_PLAN2', 'Project P3': 'PROJECTPREMIUM', 'Power Apps Premium': 'POWERAPPS_PER_USER', 'Power Automate': 'FLOW_PER_USER', 'M365 EOP1': 'EOP_ENTERPRISE_PREMIUM_P1' };
    tbody.innerHTML = rows.map(u => {
      const grps = u.license_groups || [];
      const cost = grps.reduce((s, g) => s + (_costMapLocal[sk[g]] || 0), 0);
      const dias = u.days_inactive != null ? u.days_inactive : '—';
      const diasBadge = u.days_inactive == null ? 'badge-muted' : u.days_inactive <= 30 ? 'badge-ok' : u.days_inactive <= 60 ? 'badge-warn' : 'badge-bad';
      const grpBadges = grps.map(g => `<span class="badge badge-info" style="font-size:9px;">${esc(g)}</span>`).join(' ');
      return `<tr>
        <td><div style="font-weight:600;font-size:12px;">${esc(u.display_name || '—')}</div>
            <div style="font-size:10px;color:var(--muted);">${esc(u.upn || '')}</div></td>
        <td style="font-size:11px;">${esc(u.job_title || '—')}</td>
        <td style="max-width:220px;">${grpBadges || '—'}</td>
        <td style="text-align:center;font-size:11px;">${fmtDate(u.last_activity_date)}</td>
        <td style="text-align:center;"><span class="badge ${diasBadge}">${dias}</span></td>
        <td style="text-align:center;">${statusBadge(u.activity_status)}</td>
        <td style="text-align:right;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--success);">${cost > 0 ? '$' + cost.toFixed(0) : '—'}</td>
      </tr>`;
    }).join('');
    renderPagination('dirUsrPag', parseInt(page), j.pages, loadDirUsers);
  } catch (e) { tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);padding:20px;text-align:center;">${esc(e.message)}</td></tr>`; }
}

function renderDirCharts(rows) {
  const theme = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridC = theme ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
  const txtC  = theme ? '#94a3b8' : '#64748b';
  const ranges = { '0-30 días': 0, '31-60 días': 0, '61-90 días': 0, '+90 días': 0, 'Sin dato': 0 };
  for (const u of rows) {
    if (u.days_inactive == null) ranges['Sin dato']++;
    else if (u.days_inactive <= 30) ranges['0-30 días']++;
    else if (u.days_inactive <= 60) ranges['31-60 días']++;
    else if (u.days_inactive <= 90) ranges['61-90 días']++;
    else ranges['+90 días']++;
  }
  if (_dirInactChart) _dirInactChart.destroy();
  const ctx1 = document.getElementById('dirInactChart');
  if (ctx1) _dirInactChart = new Chart(ctx1, {
    type: 'bar',
    data: { labels: Object.keys(ranges), datasets: [{ label: 'Usuarios', data: Object.values(ranges), backgroundColor: ['rgba(16,185,129,.75)', 'rgba(245,158,11,.75)', 'rgba(249,115,22,.75)', 'rgba(239,68,68,.75)', 'rgba(100,116,139,.4)'], borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw} usuarios` } } }, scales: { x: { grid: { color: gridC }, ticks: { color: txtC, font: { size: 10 } } }, y: { grid: { color: gridC }, ticks: { color: txtC, font: { size: 10 }, stepSize: 1 } } } }
  });
  const stCounts = { ACTIVO: 0, 'BAJO USO': 0, INACTIVO: 0, 'SIN USO': 0 };
  for (const u of rows) if (stCounts[u.activity_status] !== undefined) stCounts[u.activity_status]++;
  if (_dirStatusChart) _dirStatusChart.destroy();
  const ctx2 = document.getElementById('dirStatusChart');
  if (ctx2) _dirStatusChart = new Chart(ctx2, {
    type: 'doughnut',
    data: { labels: Object.keys(stCounts), datasets: [{ data: Object.values(stCounts), backgroundColor: ['rgba(16,185,129,.8)', 'rgba(245,158,11,.8)', 'rgba(249,115,22,.8)', 'rgba(239,68,68,.8)'], borderWidth: 2, borderColor: theme ? '#1e293b' : '#ffffff', hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10, color: txtC } }, tooltip: { callbacks: { label: c => `${c.label}: ${c.raw}` } } } }
  });
}

function setBreadcrumb(level) {
  const bc = document.getElementById('dirBreadcrumb');
  let html = `<span class="bc-item bc-root" onclick="drillDir(0)"><i class="bi bi-diagram-3"></i> Direcciones</span>`;
  if (level >= 1 && _selDir) {
    html += `<span class="bc-sep">›</span>`;
    if (level === 1) html += `<span class="bc-item bc-current">${esc(_selDir)}</span>`;
    else html += `<span class="bc-item" onclick="drillDir(1,'${escJs(_selDir)}')">${esc(_selDir)}</span>`;
  }
  if (level === 2 && _selArea) html += `<span class="bc-sep">›</span><span class="bc-item bc-current">${esc(_selArea)}</span>`;
  bc.innerHTML = html;
}

function escJs(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// ── Recomendaciones ───────────────────────────────────────────────────────────
async function loadRecom() {
  try {
    const j = await AppAPI.raw('/api/licenses/recommendations');
    if (!j.success) throw new Error(j.message);
    const recs     = j.data || [];
    const eliminar = recs.filter(r => r.type === 'ELIMINAR');
    const degradar = recs.filter(r => r.type === 'DEGRADAR');

    document.getElementById('recKpis').innerHTML = `
      <div class="kpi" style="border-color:rgba(239,68,68,.25);">
        <div class="kpi-lbl">Ahorro potencial total</div>
        <div class="kpi-val cg">${fmtMoney(j.totalSavings)}/mes</div>
        <div class="kpi-sub">${recs.length} recomendaciones activas</div><i class="bi bi-piggy-bank-fill kpi-ico cg"></i></div>
      <div class="kpi"><div class="kpi-lbl">Licencias a eliminar</div>
        <div class="kpi-val cr">${eliminar.reduce((a, r) => a + r.count, 0)}</div>
        <div class="kpi-sub">usuarios sin actividad >90d</div><i class="bi bi-trash-fill kpi-ico cr"></i></div>
      <div class="kpi"><div class="kpi-lbl">Candidatos a degradar</div>
        <div class="kpi-val ca">${degradar.reduce((a, r) => a + r.count, 0)}</div>
        <div class="kpi-sub">usuarios E5 sin uso avanzado</div><i class="bi bi-arrow-down-circle-fill kpi-ico ca"></i></div>
    `;

    if (!recs.length) { document.getElementById('recList').innerHTML = `<div class="empty"><i class="bi bi-check-circle"></i>No se detectaron oportunidades de optimización</div>`; return; }

    document.getElementById('recList').innerHTML = recs.map(rec => {
      const typeMap  = { ELIMINAR: 'rec-eliminar', DEGRADAR: 'rec-degradar', REVISAR: 'rec-revisar' };
      const userRows = (rec.users || []).map(u => `<span style="font-size:11px;background:var(--hover);border:1px solid var(--border);border-radius:6px;padding:2px 8px;display:inline-flex;align-items:center;gap:5px;">
        <i class="bi bi-person" style="color:var(--muted);"></i>${u.name || '—'}${u.dept ? ` — ${u.dept}` : ''}${u.days ? ' · ' + u.days + 'd' : ''}</span>`).join('');
      return `<div class="rec-card ${rec.priority === 'ALTA' ? 'alta' : rec.priority === 'MEDIA' ? 'media' : 'baja'}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="rec-type-badge ${typeMap[rec.type]}">${rec.type === 'ELIMINAR' ? '🗑 Eliminar' : rec.type === 'DEGRADAR' ? '⬇ Degradar' : '🔍 Revisar'}</span>
            <span class="badge ${rec.priority === 'ALTA' ? 'badge-bad' : rec.priority === 'MEDIA' ? 'badge-warn' : 'badge-blue'}" style="font-size:10px;">Prioridad ${rec.priority}</span>
          </div>
          ${rec.savings > 0 ? `<div style="font-size:20px;font-weight:900;font-family:var(--mono);color:var(--success);">${fmtMoney(rec.savings)}/mes</div>` : ''}
        </div>
        <div style="margin-top:10px;">
          <div style="font-size:14px;font-weight:700;color:var(--text);">${esc(rec.message)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">${esc(rec.detail)}</div>
          ${userRows ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:5px;">${userRows}</div>` : ''}
          ${rec.users && rec.users.length < rec.count ? `<div style="margin-top:6px;font-size:10px;color:var(--muted);">... y ${rec.count - rec.users.length} más</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) { document.getElementById('recList').innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center;">${e.message}</div>`; }
}

// ── Histórico ─────────────────────────────────────────────────────────────────
let _histChart = null, _costHistChart = null;
async function loadHistory() {
  try {
    const j = await AppAPI.raw('/api/licenses/history');
    if (!j.success) throw new Error(j.message);
    const d = j.data;
    if (!d.dates || !d.dates.length) { document.getElementById('histBody').innerHTML = `<tr><td colspan="4" class="empty"><i class="bi bi-clock-history"></i>Sin datos históricos — realiza un sync</td></tr>`; return; }
    const fmtD   = dt => dt ? new Date(dt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : dt;
    const labels = d.dates.map(fmtD);
    if (_histChart) _histChart.destroy();
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    const skuDatasets = (d.topSkuLabels || []).map((lbl, i) => ({ label: lbl, data: (d.perSku || {})[lbl] || [], borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length] + '20', tension: .35, fill: false, pointRadius: 2 }));
    _histChart = new Chart(document.getElementById('histChart'), {
      type: 'line',
      data: { labels, datasets: skuDatasets.length ? skuDatasets : [{ label: 'Total consumidas', data: d.consumed, borderColor: 'var(--primary)', tension: .35, fill: false, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } } }, scales: { x: { ticks: { font: { size: 9 } } }, y: { beginAtZero: false } } }
    });
    if (_costHistChart) _costHistChart.destroy();
    _costHistChart = new Chart(document.getElementById('costHistChart'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Costo mensual USD', data: d.cost, borderColor: 'var(--success)', backgroundColor: 'rgba(16,185,129,.1)', tension: .35, fill: true, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } }, tooltip: { callbacks: { label: c => ' $' + c.raw.toLocaleString('en-US', { minimumFractionDigits: 0 }) } } }, scales: { x: { ticks: { font: { size: 9 } } }, y: { beginAtZero: false, ticks: { callback: v => '$' + v.toLocaleString() } } } }
    });
    document.getElementById('histBody').innerHTML = [...d.dates].reverse().map((dt, i) => {
      const ri = [...d.dates].length - 1 - i;
      return `<tr>
        <td>${fmtDate(dt)}</td>
        <td style="text-align:center;font-family:var(--mono);">${(d.total[ri] || 0).toLocaleString()}</td>
        <td style="text-align:center;font-family:var(--mono);color:var(--danger);">${(d.consumed[ri] || 0).toLocaleString()}</td>
        <td style="text-align:right;font-family:var(--mono);font-weight:700;color:var(--success);">${d.cost[ri] ? '$' + parseFloat(d.cost[ri]).toLocaleString('en-US', { minimumFractionDigits: 0 }) : '—'}</td>
      </tr>`;
    }).join('');
  } catch (e) { document.getElementById('histBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);padding:20px;text-align:center;">${e.message}</td></tr>`; }
}

// ── Grupos ────────────────────────────────────────────────────────────────────
let _groupsData = [];
async function loadGroups() {
  try {
    const j = await AppAPI.raw('/api/licenses/users?limit=9999');
    const grpMap = {};
    for (const u of (j.data || [])) {
      for (const grp of (u.license_groups || [])) {
        if (!grpMap[grp]) grpMap[grp] = { count: 0, active: 0, members: [] };
        grpMap[grp].count++;
        if (u.activity_status === 'ACTIVO') grpMap[grp].active++;
        grpMap[grp].members.push(u);
      }
    }
    const LG_META = {
      'M365 E1': { color: '#3b82f6', icon: 'bi-microsoft' }, 'M365 E3': { color: '#0052CC', icon: 'bi-microsoft' },
      'M365 E5': { color: '#172B4D', icon: 'bi-microsoft' }, 'Power BI Pro': { color: '#F2C811', icon: 'bi-bar-chart-fill' },
      'Power BI Premium': { color: '#e0a800', icon: 'bi-bar-chart-fill' }, 'Visio P2': { color: '#106ebe', icon: 'bi-diagram-3-fill' },
      'Project P3': { color: '#31752f', icon: 'bi-kanban-fill' }, 'Power Apps Premium': { color: '#742774', icon: 'bi-lightning-fill' },
      'Power Automate': { color: '#0066FF', icon: 'bi-arrow-repeat' }, 'M365 EOP1': { color: '#5c2d91', icon: 'bi-shield-fill' },
    };
    _groupsData = Object.entries(grpMap).map(([label, d]) => ({ label, ...d, ...(LG_META[label] || { color: '#6b7280', icon: 'bi-collection' }) }));
    const grid = document.getElementById('groupsGrid');
    if (!_groupsData.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><i class="bi bi-collection"></i>Sin datos — realiza un sync</div>`; return; }
    grid.innerHTML = _groupsData.map(g => {
      const p = pct(g.active, g.count);
      return `<div class="grp-card" onclick="openGroupModal('${g.label.replace(/'/g, "\\'")}')">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div class="grp-icon" style="background:${g.color}18;border:1px solid ${g.color}30;">
            <i class="bi ${g.icon}" style="color:${g.color};"></i>
          </div>
          <div><div style="font-weight:700;font-size:13px;">${g.label}</div>
               <div style="font-size:10px;color:var(--muted);">grupo de licencia</div></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;">
          <div><div style="font-size:28px;font-weight:900;font-family:var(--mono);color:${g.color};">${g.count}</div>
               <div style="font-size:10px;color:var(--muted);">miembros</div></div>
          <div style="text-align:right;">
            <div style="font-size:11px;font-weight:700;color:${pctColor(p)};">${p}% activos</div>
            <div class="pbar-wrap" style="width:70px;margin-top:4px;"><div class="pbar-fill" style="width:${p}%;background:${pctColor(p)};"></div></div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { document.getElementById('groupsGrid').innerHTML = `<div style="color:var(--danger);grid-column:1/-1;">${e.message}</div>`; }
}

let _grpMembers = [];
function openGroupModal(label) {
  const g = _groupsData.find(x => x.label === label);
  if (!g) return;
  _grpMembers = g.members || [];
  document.getElementById('mGrpIco').innerHTML = `<i class="bi ${g.icon}" style="color:${g.color};"></i>`;
  document.getElementById('mGrpIco').style.background = `${g.color}18`;
  document.getElementById('mGrpTitle').textContent = g.label;
  document.getElementById('mGrpSub').textContent   = `${g.count} miembros · ${g.active} activos`;
  document.getElementById('mGrpQ').value = '';
  renderGrpMembers(_grpMembers);
  document.getElementById('groupModal').classList.add('open');
}
function filterGrpMembers(q) {
  const t = q.toLowerCase();
  renderGrpMembers(_grpMembers.filter(u => (u.display_name || '').toLowerCase().includes(t) || (u.email || '').toLowerCase().includes(t)));
}
function renderGrpMembers(members) {
  const tb = document.getElementById('mGrpBody');
  if (!members.length) { tb.innerHTML = `<tr><td colspan="4" class="empty">Sin resultados</td></tr>`; return; }
  tb.innerHTML = members.map(u => `<tr>
    <td style="font-weight:600;font-size:12px;">${esc(u.display_name || '—')}</td>
    <td class="mono">${esc(u.email || u.upn || '—')}</td>
    <td style="font-size:12px;color:var(--muted);">${esc(u.department || '—')}</td>
    <td>${statusBadge(u.activity_status)}</td>
  </tr>`).join('');
}

// ── SharePoint ────────────────────────────────────────────────────────────────
let _spSites = [], _spChart = null;
function fmtStorage(gb) { return gb >= 1024 ? (gb / 1024).toFixed(2) + ' TB' : gb.toFixed(2) + ' GB'; }
async function loadSP() {
  try {
    const j = await AppAPI.raw('/api/licenses/sharepoint');
    if (!j.success) throw new Error(j.message);
    const d = j.data; _spSites = d.sites || [];
    const s = d.stats;
    const usedTB = (s.totalGB / 1024).toFixed(2);
    document.getElementById('spKpiRow').innerHTML = `
      <div class="kpi"><div class="kpi-lbl">Sitios totales</div><div class="kpi-val cb">${s.total}</div><div class="kpi-sub">SharePoint activos</div></div>
      <div class="kpi"><div class="kpi-lbl">Con actividad 30d</div><div class="kpi-val cg">${s.activeSites}</div><div class="kpi-sub">últimos 30 días</div></div>
      <div class="kpi"><div class="kpi-lbl">Almacenamiento usado</div><div class="kpi-val cp">${usedTB} TB</div><div class="kpi-sub">${fmtStorage(s.totalGB)} consumidos</div></div>
      <div class="kpi"><div class="kpi-lbl">Total archivos</div><div class="kpi-val ci">${s.totalFiles.toLocaleString()}</div><div class="kpi-sub">en todos los sitios</div></div>
    `;
    // Avisar si Sites.Read.All no está concedido
    if (d.permissionError) {
      const warn = document.getElementById('spPermWarn');
      if (warn) { warn.style.display = 'flex'; warn.querySelector('span').textContent = d.permissionError; }
    }
    renderSP(_spSites);
    const top10 = _spSites.slice(0, 10);
    if (_spChart) _spChart.destroy();
    if (top10.length) _spChart = new Chart(document.getElementById('spChart'), {
      type: 'bar',
      data: { labels: top10.map(s => s.name || '—'), datasets: [{ label: 'GB', data: top10.map(s => s.storageGB), backgroundColor: 'rgba(59,130,246,.7)', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtStorage(c.raw) } } },
        scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } }
    });
  } catch (e) { document.getElementById('spBody').innerHTML = `<tr><td colspan="8" style="color:var(--danger);padding:20px;text-align:center;">${e.message}</td></tr>`; }
}
function renderSP(sites) {
  const tb = document.getElementById('spBody');
  if (!sites.length) { tb.innerHTML = `<tr><td colspan="8" class="empty"><i class="bi bi-cloud-slash"></i>Sin datos</td></tr>`; return; }
  tb.innerHTML = sites.map(s => {
    const pct      = s.storageAllocGB > 0 ? Math.round(s.storageGB / s.storageAllocGB * 100) : 0;
    const barColor = pct >= 90 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--success)';
    const urlShort = s.url ? s.url.replace(/^https?:\/\/[^/]+/, '') : '—';
    const createdFmt = s.createdAt ? new Date(s.createdAt).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const typeBadge = s.isPersonal
      ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:rgba(139,92,246,.12);color:var(--purple);margin-right:5px;">OneDrive</span>`
      : `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:rgba(6,182,212,.1);color:var(--info);margin-right:5px;">Sitio</span>`;
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;max-width:210px;">
          ${typeBadge}
          <span style="font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.url}">${s.name || s.url}</span>
        </div>
        <div class="mono" style="color:var(--muted);font-size:9px;max-width:210px;overflow:hidden;text-overflow:ellipsis;padding-left:2px;" title="${s.url}">${urlShort}</div>
      </td>
      <td style="font-size:12px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.owner}</td>
      <td style="text-align:right;font-family:var(--mono);font-size:12px;">${fmtStorage(s.storageAllocGB)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:5px;">
          <div class="pbar-wrap" style="flex:1;min-width:50px;"><div class="pbar-fill" style="width:${pct}%;background:${barColor};"></div></div>
          <span style="font-size:11px;font-weight:700;color:${barColor};min-width:28px;text-align:right;">${pct}%</span>
        </div>
        <div style="font-size:9px;color:var(--muted);margin-top:1px;">${fmtStorage(s.storageGB)} usados</div>
      </td>
      <td style="text-align:center;font-family:var(--mono);font-size:12px;">${(s.pageViews || 0).toLocaleString()}</td>
      <td style="text-align:center;font-family:var(--mono);font-size:12px;">${s.fileCount.toLocaleString()}</td>
      <td style="text-align:center;font-size:11px;color:var(--muted);">${createdFmt}</td>
      <td style="text-align:center;font-size:12px;">${fmtDate(s.lastActivity)}</td>
    </tr>`;
  }).join('');
}
function filterSp(q) {
  const t = q.toLowerCase();
  renderSP(_spSites.filter(s =>
    (s.name  || '').toLowerCase().includes(t) ||
    (s.url   || '').toLowerCase().includes(t) ||
    (s.owner || '').toLowerCase().includes(t)
  ));
}
async function spRefreshCache() {
  const btn = document.getElementById('spRefreshBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Actualizando...'; }
  try {
    await AppAPI.raw('/api/licenses/cache', { method: 'DELETE' });
    await loadSP();
    toast('Datos SharePoint actualizados', 'ok');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Actualizar SP'; } }
}
function spExportCSV() {
  if (!_spSites.length) return;
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Nombre del sitio', 'URL', 'Propietario', 'Asignado (GB)', 'Usado (GB)', '% Usado', 'Vistas de página', 'Archivos', 'Fecha de creación', 'Última actividad'];
  const rows = _spSites.map(s => {
    const pct = s.storageAllocGB > 0 ? Math.round(s.storageGB / s.storageAllocGB * 100) : 0;
    const createdFmt = s.createdAt ? new Date(s.createdAt).toLocaleDateString('es-PE') : '';
    return [s.name, s.url, s.owner, s.storageAllocGB.toFixed(2), s.storageGB.toFixed(2), pct + '%', s.pageViews || 0, s.fileCount, createdFmt, s.lastActivity || ''].map(esc).join(',');
  });
  const csv = '﻿' + [headers.map(esc).join(','), ...rows].join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })), download: `sharepoint_${new Date().toISOString().split('T')[0]}.csv` });
  a.click();
}

// ── Cost config modal ─────────────────────────────────────────────────────────
async function openCostModal() {
  document.getElementById('costModal').classList.add('open');
  try {
    const j = await AppAPI.raw('/api/licenses/cost-config');
    const rows = j.data || [];
    _costMapLocal = Object.fromEntries(rows.map(r => [r.sku_name, parseFloat(r.cost_per_user) || 0]));
    document.getElementById('costCfgBody').innerHTML = rows.map(row => `
      <tr>
        <td class="mono" style="font-size:11px;">${row.sku_name}</td>
        <td style="font-size:12px;">${row.label || row.sku_name}</td>
        <td style="text-align:right;">
          <input type="number" class="cost-inp" id="cost_${row.sku_name.replace(/[^a-zA-Z0-9]/g, '_')}"
            value="${parseFloat(row.cost_per_user || 0).toFixed(2)}" step="0.01" min="0">
        </td>
        <td style="text-align:center;">
          <button class="btn-sm-act btn-primary" style="padding:4px 10px;font-size:11px;"
            onclick="saveCost('${row.sku_name}','${row.sku_name.replace(/[^a-zA-Z0-9]/g, '_')}')">
            <i class="bi bi-check"></i>
          </button>
        </td>
      </tr>`).join('');
  } catch (e) { document.getElementById('costCfgBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${e.message}</td></tr>`; }
}

async function saveCost(skuName, inputId) {
  const val = document.getElementById('cost_' + inputId)?.value;
  try {
    const j = await AppAPI.raw('/api/licenses/cost-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku_name: skuName, cost_per_user: parseFloat(val) || 0 }),
    });
    if (j.success) { toast('Costo actualizado', 'ok'); _loaded['resumen'] = false; loadOverview(); }
    else throw new Error(j.message);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ── Depts list for filter ─────────────────────────────────────────────────────
async function loadDeptFilter() {
  try {
    const j = await AppAPI.raw('/api/licenses/departments-list');
    const sel = document.getElementById('userDept');
    (j.data || []).forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
  } catch { /* non-critical */ }
}

// ── Alertas M365 ─────────────────────────────────────────────────────────────
window.loadAlerts = async function(force = false) {
  if (force) { delete _loaded['alertas']; _loaded['alertas'] = true; }
  const kpiRow  = document.getElementById('alertKpiRow');
  const list    = document.getElementById('alertsList');
  const iconMap = { noncompliant: 'bi-laptop-fill', risky: 'bi-person-fill-exclamation', license: 'bi-key-fill' };
  if (list) list.innerHTML = '<div class="empty" style="padding:40px;"><i class="bi bi-hourglass-split"></i>Analizando tenant…</div>';
  try {
    const d = await AppAPI.raw('/api/ms/alerts');
    const total = d.data?.length || 0;
    const badge = document.getElementById('alertasTabBadge');
    if (badge) { badge.textContent = total; badge.style.display = total ? 'inline' : 'none'; }
    const c = d.counts || {};
    if (kpiRow) kpiRow.innerHTML = `
      <div class="kpi kpi-warn">
        <div class="kpi-lbl">No conformes</div>
        <div class="kpi-val cr">${c.noncompliant || 0}</div>
        <div class="kpi-sub">Dispositivos Intune</div>
        <i class="kpi-ico bi bi-laptop-fill"></i>
      </div>
      <div class="kpi">
        <div class="kpi-lbl">En riesgo</div>
        <div class="kpi-val ca">${c.risky || 0}</div>
        <div class="kpi-sub">Usuarios de Entra ID</div>
        <i class="kpi-ico bi bi-person-fill-exclamation"></i>
      </div>
      <div class="kpi kpi-warn">
        <div class="kpi-lbl">Lic. críticas</div>
        <div class="kpi-val cr">${c.licensePressure || 0}</div>
        <div class="kpi-sub">SKUs al 95%+</div>
        <i class="kpi-ico bi bi-key-fill"></i>
      </div>`;
    if (!total) {
      if (list) list.innerHTML = '<div class="empty" style="padding:48px;"><i class="bi bi-check-circle-fill" style="color:var(--success);opacity:1;font-size:40px;"></i><div style="margin-top:8px;font-size:14px;font-weight:700;">Sin alertas activas</div><div style="font-size:12px;margin-top:4px;">El tenant cumple con todos los umbrales monitorizados.</div></div>';
      return;
    }
    if (list) list.innerHTML = (d.data || []).map(a => `
      <div class="alrt-card ${a.level || 'warning'}">
        <div class="alrt-ico"><i class="bi ${iconMap[a.type] || 'bi-exclamation-triangle-fill'}"></i></div>
        <div style="flex:1;min-width:0;">
          <div class="alrt-title">${esc(a.title)}</div>
          <div class="alrt-detail">${esc(a.detail)}</div>
        </div>
        ${a.date ? `<div class="alrt-date">${fmtDate(a.date)}</div>` : ''}
      </div>`).join('');
  } catch (e) {
    if (list) list.innerHTML = `<div class="empty" style="color:var(--danger);"><i class="bi bi-exclamation-triangle-fill" style="opacity:1;color:var(--danger);"></i>${esc(e.message)}</div>`;
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadOverview();
  await loadDeptFilter();
  try {
    const j = await AppAPI.raw('/api/licenses/cost-config');
    _costMapLocal = Object.fromEntries((j.data || []).map(r => [r.sku_name, parseFloat(r.cost_per_user) || 0]));
  } catch { /* non-critical */ }
  const rs = await AppAPI.raw('/api/licenses/sync-status').catch(() => null);
  if (rs?.sync?.running) pollSync();
})();

// ── Uso de aplicaciones M365 ──────────────────────────────────────────────────
async function loadLicReports(force = false) {
  if (force) { delete _loaded['usoapps']; _loaded['usoapps'] = true; }
  const el = document.getElementById('licReportsContent');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="padding:40px;"><i class="bi bi-hourglass-split"></i> Cargando uso de aplicaciones…</div>';
  try {
    const r = await fetch('/api/ms/reports/trends', { credentials: 'include' });
    const d = await r.json();
    if (!d.success) {
      el.innerHTML = `<div class="empty" style="padding:48px;text-align:center;"><i class="bi bi-cloud-slash" style="font-size:32px;display:block;margin-bottom:12px;"></i>MS Graph no disponible. Verifica el permiso <code>Reports.Read.All</code>.</div>`;
      return;
    }
    const services = d.services || [];
    if (!services.length) {
      el.innerHTML = `<div class="empty" style="padding:48px;text-align:center;"><i class="bi bi-graph-up-arrow" style="font-size:32px;color:var(--primary);display:block;margin-bottom:12px;"></i><div style="font-weight:700;margin-bottom:8px;">Sin datos de uso disponibles</div><div style="font-size:12px;">Verifica que el permiso <code>Reports.Read.All</code> esté concedido en Azure AD.</div></div>`;
      return;
    }
    const cols   = Object.keys(services[0]).filter(k => !k.toLowerCase().includes('date'));
    const last   = services[services.length - 1] || {};
    const colors = ['#0078d4','#6264a7','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#db2777'];
    const cards  = cols.slice(0, 8).map((col, i) => {
      const val   = parseInt(last[col]) || 0;
      const prev  = parseInt(services[services.length - 8]?.[col]) || 0;
      const trend = val > prev ? '↑' : val < prev ? '↓' : '→';
      const tClr  = val > prev ? '#059669' : val < prev ? '#dc2626' : '#64748b';
      const label = col.replace(/([A-Z])/g, ' $1').trim();
      return `<div class="kpi" style="flex-direction:column;align-items:flex-start;gap:2px;padding:16px 18px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;color:var(--muted);margin-bottom:4px;">${esc(label)}</div>
        <div style="font-size:26px;font-weight:900;color:${colors[i % colors.length]};">${val.toLocaleString()} <span style="font-size:14px;color:${tClr};">${trend}</span></div>
        <div style="font-size:10px;color:var(--muted);">usuarios activos · últimos 30d</div>
      </div>`;
    }).join('');
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:12px;">${cards}</div>
      <div style="font-size:11px;color:var(--muted);text-align:right;">Actividad por servicio · Período de 30 días · ${services.length} puntos de datos</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty" style="padding:32px;color:var(--danger);"><i class="bi bi-exclamation-triangle me-2"></i>${esc(e.message)}</div>`;
  }
}

// ── Tendencias 30d ────────────────────────────────────────────────────────────
async function loadLicTrends(force = false) {
  if (force) { delete _loaded['tendencias']; _loaded['tendencias'] = true; }
  const el = document.getElementById('licTrendsContent');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="padding:40px;"><i class="bi bi-hourglass-split"></i> Cargando datos de tendencias…</div>';
  try {
    const r = await fetch('/api/ms/reports/trends', { credentials: 'include' });
    const d = await r.json();
    if (!d.success) {
      el.innerHTML = `<div class="empty" style="padding:48px;text-align:center;"><i class="bi bi-cloud-slash" style="font-size:32px;display:block;margin-bottom:12px;"></i>MS Graph no disponible.</div>`;
      return;
    }
    const active = d.active || [];
    if (!active.length) {
      el.innerHTML = `<div class="empty" style="padding:48px;text-align:center;">Sin datos de tendencias disponibles. Verifica el permiso <code>Reports.Read.All</code>.</div>`;
      return;
    }
    const cols   = Object.keys(active[0]).filter(k => k.toLowerCase() !== 'reportrefreshdate' && k.toLowerCase() !== 'reportdate');
    const recent = active.slice(-14);
    const maxVal = Math.max(...recent.flatMap(row => cols.map(c => parseInt(row[c]) || 0)), 1);
    const colors = ['#0078d4','#7c3aed','#059669','#d97706','#dc2626','#6264a7'];
    const charts = cols.slice(0, 6).map((col, i) => {
      const vals    = recent.map(row => parseInt(row[col]) || 0);
      const bars    = vals.map(v => `<div style="height:${Math.max(4, Math.round(v / maxVal * 55))}px;background:${colors[i % colors.length]}22;border-top:2px solid ${colors[i % colors.length]};border-radius:2px 2px 0 0;flex:1;min-width:4px;"></div>`).join('');
      const lastVal = vals[vals.length - 1] || 0;
      const label   = col.replace(/([A-Z])/g, ' $1').trim();
      return `<div class="card-ui" style="padding:16px 18px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${esc(label)}</div>
        <div style="font-size:24px;font-weight:800;color:${colors[i % colors.length]};margin-bottom:2px;">${lastVal.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:10px;">usuarios activos hoy</div>
        <div style="display:flex;align-items:flex-end;gap:2px;height:60px;">${bars}</div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-top:4px;"><span>14 días atrás</span><span>Hoy</span></div>
      </div>`;
    }).join('');
    el.innerHTML = `<div style="margin-bottom:12px;font-size:12px;color:var(--muted);">Datos de los últimos 30 días · ${active.length} puntos de datos</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;">${charts}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty" style="padding:32px;color:var(--danger);"><i class="bi bi-exclamation-triangle me-2"></i>${esc(e.message)}</div>`;
  }
}

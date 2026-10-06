/* Selector de empresa para técnicos multiempresa.
 * Solo aparece si el usuario atiende más de una empresa. Muestra siempre en qué
 * empresa se está trabajando (barra de color) para no operar en el cliente equivocado. */
(function () {
  'use strict';
  if (window.__companySwitcher) return;
  window.__companySwitcher = true;

  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ROLE = { administrador: 'Administrador', especialista: 'Técnico', agente: 'Técnico', tecnico: 'Técnico' };

  function css() {
    var s = document.createElement('style');
    s.textContent =
      '#csw{position:fixed;right:14px;bottom:14px;z-index:2147483000;font-family:inherit;font-size:13px}' +
      '#csw .csw-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;border:1.5px solid rgba(0,0,0,.12);background:#fff;color:#0f172a;cursor:pointer;box-shadow:0 6px 20px rgba(15,23,42,.18);font:inherit;font-weight:700;max-width:280px}' +
      '#csw .csw-btn span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#csw.away .csw-btn{background:#7c3aed;border-color:#7c3aed;color:#fff}' +
      '#csw .csw-menu{position:absolute;right:0;bottom:calc(100% + 8px);min-width:260px;max-height:60vh;overflow:auto;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:6px;display:none}' +
      '#csw.open .csw-menu{display:block}' +
      '#csw .csw-h{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;padding:6px 10px}' +
      '#csw .csw-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;background:none;border-radius:8px;cursor:pointer;font:inherit;color:inherit;text-align:left}' +
      '#csw .csw-item:hover,#csw .csw-item:focus-visible{background:#f1f5f9;outline:none}' +
      '#csw .csw-item small{display:block;color:#64748b;font-size:11px}' +
      '#csw .csw-item .bi-check2{margin-left:auto;color:#7c3aed}' +
      '#csw-bar{position:fixed;left:0;right:0;top:0;height:3px;background:#7c3aed;z-index:2147483000;pointer-events:none}' +
      '[data-theme="dark"] #csw .csw-btn:not(.x),[data-theme="dark"] #csw .csw-menu{background:#111827;color:#f1f5f9;border-color:#1e293b}' +
      '[data-theme="dark"] #csw.away .csw-btn{background:#7c3aed;color:#fff}' +
      '[data-theme="dark"] #csw .csw-item:hover{background:#1e293b}';
    document.head.appendChild(s);
  }

  function render(list) {
    var active = list.filter(function (c) { return c.active; })[0] || list[0];
    var away = active && !active.home;
    var box = document.createElement('div');
    box.id = 'csw';
    if (away) box.className = 'away';
    box.innerHTML =
      '<div class="csw-menu" role="menu"><div class="csw-h">Empresas que atiendes</div>' +
      list.map(function (c) {
        return '<button class="csw-item" role="menuitem" data-id="' + Number(c.id) + '"><i class="bi ' + (c.home ? 'bi-house-door' : 'bi-building') + '"></i>' +
               '<span>' + esc(c.name) + '<small>' + (c.home ? 'Tu empresa · ' : 'Cliente · ') + esc(ROLE[c.role] || c.role) + '</small></span>' +
               (c.active ? '<i class="bi bi-check2"></i>' : '') + '</button>';
      }).join('') + '</div>' +
      '<button class="csw-btn" aria-haspopup="true" title="Cambiar de empresa"><i class="bi ' + (away ? 'bi-building' : 'bi-house-door') + '"></i>' +
      '<span>' + esc(active ? active.name : 'Empresa') + '</span><i class="bi bi-chevron-expand"></i></button>';
    document.body.appendChild(box);
    if (away) { var bar = document.createElement('div'); bar.id = 'csw-bar'; document.body.appendChild(bar); }

    box.querySelector('.csw-btn').addEventListener('click', function (e) { e.stopPropagation(); box.classList.toggle('open'); });
    document.addEventListener('click', function () { box.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.classList.remove('open'); });
    Array.prototype.forEach.call(box.querySelectorAll('.csw-item'), function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-id'));
        if (active && id === Number(active.id)) { box.classList.remove('open'); return; }
        b.disabled = true;
        fetch('/api/companies/switch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: id }) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j.success) { alert(j.message || 'No se pudo cambiar de empresa'); b.disabled = false; return; }
            location.href = location.pathname;   // recarga sin parámetros: todo se muestra de la nueva empresa
          })
          .catch(function () { alert('Sin conexión'); b.disabled = false; });
      });
    });
  }

  function init() {
    fetch('/api/companies/mine', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.success && j.data && j.data.length > 1) { css(); render(j.data); } })
      .catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

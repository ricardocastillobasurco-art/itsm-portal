/* Aviso del plan en el panel de TI: días de prueba restantes o límites del plan Gratis
 * cerca de agotarse. Se puede cerrar (vuelve a aparecer en la siguiente sesión). */
(function () {
  'use strict';
  if (window.__planBanner) return;
  window.__planBanner = true;
  var KEY = 'planBannerOff';
  var off = false;
  try { off = !!sessionStorage.getItem(KEY); } catch (_) {}
  var NAMES = { technicians: 'técnicos', devices: 'equipos con control remoto', ai_per_month: 'consultas al asistente este mes', storage_gb: 'GB de adjuntos' };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function show(html, tone) {
    if (off) return;
    var s = document.createElement('style');
    s.textContent = '#planBanner{position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:2147482999;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);' +
      'padding:8px 10px 8px 14px;border-radius:12px;font-family:inherit;font-size:13px;box-shadow:0 8px 24px rgba(15,23,42,.18)}' +
      '#planBanner.info{background:#1d4ed8;color:#fff}#planBanner.warn{background:#b45309;color:#fff}' +
      '#planBanner a{color:#fff;font-weight:800;text-decoration:underline;white-space:nowrap}' +
      '#planBanner button{border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:8px;cursor:pointer;padding:2px 7px;font-size:14px}';
    document.head.appendChild(s);
    var b = document.createElement('div');
    b.id = 'planBanner'; b.className = tone; b.setAttribute('role', 'status');
    b.innerHTML = '<span>' + html + '</span><a href="/planes">Ver planes</a><button aria-label="Cerrar" title="Cerrar">×</button>';
    b.querySelector('button').onclick = function () { b.remove(); try { sessionStorage.setItem(KEY, '1'); } catch (_) {} };
    document.body.appendChild(b);
  }

  // "Primeros pasos": tarjeta plegable abajo a la derecha hasta completar o cerrar
  function checklist() {
    if (/^\/(bienvenida|planes)/.test(location.pathname)) return;
    fetch('/api/plan/checklist', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var c = j && j.success && j.data;
      if (!c || c.dismissed || c.complete) return;
      var open = true; try { open = localStorage.getItem('gsOpen') !== '0'; } catch (_) {}
      var st = document.createElement('style');
      st.textContent = '#gsCard{position:fixed;right:16px;bottom:16px;z-index:2147482998;width:300px;max-width:calc(100% - 32px);background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.18);font-family:inherit;font-size:13px;overflow:hidden}' +
        '@media (prefers-color-scheme:dark){#gsCard{background:#111827;color:#f1f5f9;border-color:#1e293b}}' +
        '#gsCard .h{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;font-weight:800}' +
        '#gsCard .h .p{margin-left:auto;font-size:11.5px;color:#64748b;font-weight:700}' +
        '#gsCard .bar{height:4px;background:rgba(100,116,139,.18)}#gsCard .bar span{display:block;height:100%;background:#2563eb}' +
        '#gsCard ul{list-style:none;margin:0;padding:6px 8px 8px}#gsCard li a{display:flex;gap:9px;padding:7px 6px;border-radius:9px;color:inherit;text-decoration:none}' +
        '#gsCard li a:hover{background:rgba(37,99,235,.08)}#gsCard li i{font-size:16px;margin-top:1px}#gsCard li small{display:block;color:#64748b;font-size:11.5px}' +
        '#gsCard li.ok b{text-decoration:line-through;opacity:.6}#gsCard .x{border:0;background:none;color:#94a3b8;cursor:pointer;font-size:12px;padding:0 12px 10px}';
      document.head.appendChild(st);
      var card = document.createElement('div'); card.id = 'gsCard';
      var pct = Math.round(c.done / c.total * 100);
      card.innerHTML = '<div class="h"><i class="bi bi-rocket-takeoff" style="color:#2563eb"></i>Primeros pasos<span class="p">' + c.done + ' de ' + c.total + '</span></div>' +
        '<div class="bar"><span style="width:' + pct + '%"></span></div><div class="b"' + (open ? '' : ' hidden') + '><ul>' +
        c.items.map(function (i) {
          return '<li class="' + (i.done ? 'ok' : '') + '"><a href="' + esc(i.href) + '"><i class="bi ' + (i.done ? 'bi-check-circle-fill" style="color:#059669' : 'bi-circle" style="color:#94a3b8') + '"></i><span><b>' + esc(i.title) + '</b><small>' + esc(i.desc) + '</small></span></a></li>';
        }).join('') + '</ul><button class="x">No volver a mostrar</button></div>';
      card.querySelector('.h').onclick = function () {
        var body = card.querySelector('.b'); body.hidden = !body.hidden;
        try { localStorage.setItem('gsOpen', body.hidden ? '0' : '1'); } catch (_) {}
      };
      card.querySelector('.x').onclick = function () {
        card.remove();
        fetch('/api/plan/checklist/dismiss', { method: 'POST', credentials: 'include' }).catch(function () {});
      };
      document.body.appendChild(card);
    }).catch(function () {});
  }

  fetch('/api/plan/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    var d = j && j.success && j.data;
    if (!d || d.unlimited) return;
    checklist();
    if (d.plan === 'trial' && d.trialDaysLeft != null) {
      var n = d.trialDaysLeft;
      return show('<b>Prueba gratis:</b> ' + (n <= 0 ? 'termina hoy' : 'te ' + (n === 1 ? 'queda 1 día' : 'quedan ' + n + ' días')) +
        '. Después sigues en el plan Gratis sin perder nada.', n <= 3 ? 'warn' : 'info');
    }
    if (d.near && d.near.length) {
      var parts = d.near.map(function (k) { return esc(d.usage[k]) + ' de ' + esc(d.limits[k]) + ' ' + (NAMES[k] || k); });
      show('<b>Plan ' + esc(d.label) + ':</b> estás cerca del límite (' + parts.join(' · ') + ').', 'warn');
    }
  }).catch(function () {});
})();

/* Aviso del plan en el panel de TI: días de prueba restantes o límites del plan Gratis
 * cerca de agotarse. Se puede cerrar (vuelve a aparecer en la siguiente sesión). */
(function () {
  'use strict';
  if (window.__planBanner) return;
  window.__planBanner = true;
  var KEY = 'planBannerOff';
  try { if (sessionStorage.getItem(KEY)) return; } catch (_) {}
  var NAMES = { technicians: 'técnicos', devices: 'equipos con control remoto', ai_per_month: 'consultas al asistente este mes', storage_gb: 'GB de adjuntos' };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function show(html, tone) {
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

  fetch('/api/plan/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    var d = j && j.success && j.data;
    if (!d || d.unlimited) return;
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

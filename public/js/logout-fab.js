(function(){
  document.addEventListener('DOMContentLoaded', function(){
    // Ya existe botón de salir → no duplicar
    if (document.getElementById('ttfLogout') || document.querySelector('a[href*="/logout"],.nav-exit')) return;
    // Dentro de iframe → no mostrar
    if (window.self !== window.top) return;
    var a = document.createElement('a');
    a.href = '/api/auth/logout';
    a.id   = 'ttfLogout';
    a.title = 'Cerrar sesión';
    a.innerHTML = '<i class="bi bi-box-arrow-right"></i> Salir';
    a.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#64748b;text-decoration:none;padding:6px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:30px;position:fixed;top:14px;right:16px;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,.1);transition:color .15s,border-color .15s;white-space:nowrap;';
    a.onmouseover = function(){ this.style.color='#ef4444'; this.style.borderColor='#ef4444'; };
    a.onmouseout  = function(){ this.style.color='#64748b'; this.style.borderColor='#e2e8f0'; };
    document.body.appendChild(a);
  });
})();

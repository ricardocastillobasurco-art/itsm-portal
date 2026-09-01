(function () {
  const F = window.TENANT_FEATURES || {};

  function applyGates() {
    // Oculta elementos con data-feature="X" cuando X está deshabilitado
    document.querySelectorAll('[data-feature]').forEach(function (el) {
      var key = el.getAttribute('data-feature');
      if (F[key] === false) el.style.display = 'none';
    });

    // Oculta contenedores data-feature-group="X,Y,Z" cuando TODOS están deshabilitados
    document.querySelectorAll('[data-feature-group]').forEach(function (el) {
      var keys = el.getAttribute('data-feature-group').split(',');
      var anyEnabled = keys.some(function (k) { return F[k.trim()] !== false; });
      if (!anyEnabled) el.style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyGates);
  } else {
    applyGates();
  }
})();

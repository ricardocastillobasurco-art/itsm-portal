/**
 * AppUI — Shared UI utilities.
 * Namespaced to avoid conflict with Jira-page toast() global.
 *
 * Usage:
 *   AppUI.toast('Guardado', 'ok');
 *   AppUI.toast('Error al guardar', 'err');
 *   AppUI.setLoading(btn, true);
 *   AppUI.setLoading(btn, false, 'Guardar');
 *   const ok = await AppUI.confirm('¿Eliminar este registro?');
 */
window.AppUI = (() => {
  // ── Toast ─────────────────────────────────────────────────────────────────

  function _ensureToastContainer() {
    let box = document.getElementById('appToastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'appToastBox';
      box.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;';
      document.body.appendChild(box);
    }
    return box;
  }

  function toast(msg, type = 'inf') {
    const box = _ensureToastContainer();
    const d   = document.createElement('div');
    const styles = {
      ok:  'background:#16a34a;color:#fff',
      err: 'background:#dc2626;color:#fff',
      inf: 'background:#1d4ed8;color:#fff',
      warn:'background:#d97706;color:#fff',
    };
    d.style.cssText = `padding:.65rem 1rem;border-radius:.5rem;font-size:.875rem;box-shadow:0 4px 12px rgba(0,0,0,.2);
      display:flex;align-items:center;gap:.5rem;max-width:340px;animation:_fadeIn .2s ease;
      ${styles[type] || styles.inf}`;
    const ico = { ok: '✓', err: '✗', inf: 'ℹ', warn: '⚠' }[type] || '·';
    d.innerHTML = `<strong>${ico}</strong><span>${msg}</span>`;
    box.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 300); }, 4000);
  }

  // ── Button loading state ──────────────────────────────────────────────────

  function setLoading(btn, loading, originalText) {
    if (!btn) return;
    if (loading) {
      btn._origText = btn.innerHTML;
      btn.disabled  = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Cargando…';
    } else {
      btn.disabled  = false;
      btn.innerHTML = originalText || btn._origText || 'Aceptar';
      delete btn._origText;
    }
  }

  // ── Confirm dialog ────────────────────────────────────────────────────────

  function confirm(msg, { title = 'Confirmar', okLabel = 'Aceptar', okClass = 'btn-danger' } = {}) {
    return new Promise(resolve => {
      const id = '_appConfirm_' + Date.now();
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">${title}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body"><p>${msg}</p></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" class="btn ${okClass}" id="${id}_ok">${okLabel}</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(el);

      const modal = new bootstrap.Modal(document.getElementById(id));
      modal.show();

      document.getElementById(id + '_ok').addEventListener('click', () => {
        modal.hide(); resolve(true);
      });
      document.getElementById(id).addEventListener('hidden.bs.modal', () => {
        el.remove(); resolve(false);
      }, { once: true });
    });
  }

  // ── Skeleton / placeholder ────────────────────────────────────────────────

  function skeleton(container, rows = 3) {
    const html = Array.from({ length: rows }, () =>
      `<div class="placeholder-glow mb-2"><span class="placeholder col-12 rounded" style="height:2rem"></span></div>`
    ).join('');
    container.innerHTML = html;
  }

  return { toast, setLoading, confirm, skeleton };
})();

// Inject keyframe once
if (!document.getElementById('_appUIStyles')) {
  const s = document.createElement('style');
  s.id = '_appUIStyles';
  s.textContent = '@keyframes _fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}';
  document.head.appendChild(s);
}

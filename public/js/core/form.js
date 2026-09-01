/**
 * AppForm — Form utilities.
 * Serialize, validate required fields, and reset.
 *
 * Usage:
 *   const data = AppForm.serialize('#myForm');
 *   // → { full_name: 'Ana', email: 'ana@example.com' }
 *
 *   const ok = AppForm.validate('#myForm');
 *   // Adds .is-invalid to empty required fields, returns bool.
 *
 *   AppForm.reset('#myForm');
 */
window.AppForm = (() => {
  function _el(selector) {
    return typeof selector === 'string' ? document.querySelector(selector) : selector;
  }

  /**
   * Serialize all named inputs/selects/textareas into a plain object.
   * Checkboxes return boolean. Multi-selects return array.
   */
  function serialize(formSelector) {
    const form = _el(formSelector);
    if (!form) return {};
    const data = {};
    new FormData(form).forEach((val, key) => {
      if (key in data) {
        data[key] = [].concat(data[key], val);
      } else {
        data[key] = val;
      }
    });
    // Convert checkbox values
    form.querySelectorAll('input[type=checkbox]').forEach(cb => {
      data[cb.name] = cb.checked;
    });
    return data;
  }

  /**
   * Validate required fields. Marks invalid ones with Bootstrap's .is-invalid.
   * Returns true if all required fields are filled.
   */
  function validate(formSelector) {
    const form = _el(formSelector);
    if (!form) return true;
    let valid = true;
    form.querySelectorAll('[required]').forEach(el => {
      const empty = !el.value || !el.value.trim();
      el.classList.toggle('is-invalid', empty);
      if (empty) valid = false;
    });
    return valid;
  }

  /** Clear all inputs and remove validation classes. */
  function reset(formSelector) {
    const form = _el(formSelector);
    if (!form) return;
    form.reset();
    form.querySelectorAll('.is-invalid, .is-valid').forEach(el => {
      el.classList.remove('is-invalid', 'is-valid');
    });
  }

  /** Populate form fields from a data object (key = input name). */
  function fill(formSelector, data) {
    const form = _el(formSelector);
    if (!form || !data) return;
    Object.entries(data).forEach(([key, val]) => {
      const el = form.querySelector(`[name="${key}"]`);
      if (!el) return;
      if (el.type === 'checkbox') { el.checked = !!val; }
      else { el.value = val ?? ''; }
    });
  }

  return { serialize, validate, reset, fill };
})();

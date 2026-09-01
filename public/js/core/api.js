/**
 * AppAPI — Unified HTTP client for all pages.
 * Uses fetch with credentials:'same-origin' (cookies sent automatically).
 * On 401 redirects to login. On network error throws with .message.
 *
 * Usage:
 *   const data = await AppAPI.get('/api/employees');
 *   await AppAPI.post('/api/employees', { full_name: 'Ana' });
 *   await AppAPI.patch('/api/employees/5', { is_active: false });
 *   await AppAPI.del('/api/employees/5');
 */
window.AppAPI = (() => {
  const LOGIN_URL = '/api/auth/login';

  async function _request(method, url, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(url, opts);
    } catch (networkErr) {
      throw new Error('Sin conexión con el servidor');
    }

    if (res.status === 401) {
      window.location.href = LOGIN_URL;
      throw new Error('Sesión expirada');
    }

    let json;
    try {
      json = await res.json();
    } catch {
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return null;
    }

    if (!res.ok) {
      const msg = json?.error || json?.message || `Error ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status, data: json });
    }

    return json?.data !== undefined ? json.data : json;
  }

  return {
    get:   (url)        => _request('GET',    url),
    post:  (url, body)  => _request('POST',   url, body),
    put:   (url, body)  => _request('PUT',    url, body),
    patch: (url, body)  => _request('PATCH',  url, body),
    del:   (url)        => _request('DELETE', url),
    /** Raw fetch — returns full response JSON (success + data + pagination). */
    raw:   (url, opts)  => fetch(url, { credentials: 'same-origin', ...opts }).then(r => r.json()),
  };
})();

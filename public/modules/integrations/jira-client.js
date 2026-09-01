/**
 * ============================================================
 * MÓDULO: jira-client.js
 * ============================================================
 * Responsabilidad: Toda la comunicación HTTP con la API de Jira.
 * Centraliza el enrutamiento a través del proxy local (/jira/*),
 * la inyección de cabeceras de autenticación y el manejo de
 * errores de red/API.
 *
 * Expone:
 *  - jiraRaw(method, fullUrl, email, token, body) → llamada explícita
 *  - jira(method, path, body)                     → llamada usando CFG
 *  - adf(text)                                    → helper para formato ADF
 * ============================================================
 */

/**
 * Realiza una petición HTTP a la API de Jira a través del proxy
 * local. Acepta credenciales explícitas para poder usarse antes
 * de que CFG esté inicializado (ej: testConnection).
 *
 * Flujo:
 *  1. Extrae el pathname + search de la URL completa
 *  2. Prefija con '/jira' para que el proxy lo reenvíe al servidor real
 *  3. Inyecta las cabeceras de autenticación que el proxy necesita
 *  4. Parsea la respuesta como JSON; lanza Error si !res.ok
 *
 * @param {string} method    - Verbo HTTP: 'GET' | 'POST' | 'PUT' | 'DELETE'
 * @param {string} fullUrl   - URL completa o ruta relativa del endpoint Jira
 * @param {string} email     - Correo del agente (para Basic Auth via proxy)
 * @param {string} token     - API token de Jira
 * @param {Object} [body]    - Cuerpo de la petición (se serializa a JSON)
 * @returns {Promise<Object>} Respuesta deserializada de Jira
 * @throws {Error} Si la respuesta HTTP no es 2xx, lanza el mensaje de error de Jira
 */
async function jiraRaw(method, fullUrl, email, token, body) {
  // Extraer solo el path+query para el proxy local
  let proxyPath = fullUrl;
  try {
    const u = new URL(fullUrl);
    proxyPath = u.pathname + u.search;
  } catch { /* si no es URL absoluta, se usa tal cual */ }

  const res = await fetch('/jira' + proxyPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'jira_url':     CFG.url,    // El proxy reemplaza el host real con este valor
      'jira_email':   email,
      'jira_token':   token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try   { json = JSON.parse(text); }
  catch { json = { _raw: text };   }

  if (!res.ok) {
    throw new Error(
      json.errorMessages?.[0] || json.message || json.error || `HTTP ${res.status}`
    );
  }
  return json;
}

/**
 * Wrapper conveniente de jiraRaw que toma las credenciales
 * directamente de CFG. Es la función que usan todos los flujos
 * de negocio (tickets, asignaciones, transiciones, etc.).
 *
 * @param {string} method  - Verbo HTTP
 * @param {string} path    - Ruta relativa de la API de Jira (ej: '/rest/api/3/issue/INC-1')
 * @param {Object} [body]  - Cuerpo opcional
 * @returns {Promise<Object>}
 */
function jira(method, path, body) {
  return jiraRaw(method, CFG.url + path, CFG.email, CFG.token, body);
}

/**
 * Construye un nodo de texto en formato ADF (Atlassian Document Format),
 * requerido por los endpoints de Jira v3 para comentarios y descripciones.
 *
 * El ADF es el rich-text format interno de Jira Cloud.
 * Un párrafo simple envuelve un nodo de texto plano.
 *
 * @param {string} text - Texto plano a envolver
 * @returns {Object} Documento ADF mínimo con un párrafo
 *
 * @example
 * // Resultado:
 * // { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola' }] }] }
 * adf('Hola')
 */
function adf(text) {
  return {
    type:    'doc',
    version: 1,
    content: [{
      type:    'paragraph',
      content: [{ type: 'text', text }],
    }],
  };
}

'use strict';

const { _encrypt, _decrypt } = require('./msTokenCache');
const { dbQuery }            = require('../../routes/jira/helpers');
const axios                  = require('axios');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_BETA = 'https://graph.microsoft.com/beta';

// Scopes delegados válidos para Graph API (acquireTokenSilent con refresh token)
// Solo se incluyen permisos delegados confirmados — no app-only
const GRAPH_SCOPES = [
  'User.Read',
  'User.Read.All',
  'Group.Read.All',
  'Directory.Read.All',
  'Organization.Read.All',
  'AuditLog.Read.All',
  'Reports.Read.All',
  'DeviceManagementManagedDevices.Read.All',
  'DeviceManagementConfiguration.Read.All',
  'DeviceManagementApps.Read.All',
  'DeviceManagementServiceConfig.Read.All',
  'Sites.Read.All',
  'Files.Read.All',
  'MailboxSettings.Read',
  'Team.ReadBasic.All',
  'Policy.Read.All',
];

class GraphAuthError extends Error {
  constructor(msg) { super(msg); this.name = 'GraphAuthError'; this.msReauth = true; }
}
class GraphForbiddenError extends Error {
  constructor(msg) { super(msg); this.name = 'GraphForbiddenError'; this.forbidden = true; }
}

async function getAccessToken(userId) {
  const rows = await dbQuery(
    'SELECT ms_home_account_id, ms_token_cache FROM users WHERE id=? LIMIT 1',
    [userId]
  );
  const row = rows?.[0];
  if (!row?.ms_home_account_id || !row?.ms_token_cache) {
    throw new GraphAuthError('Sin sesión Microsoft. Inicia sesión con Microsoft.');
  }

  // Extraer refresh token del cache cifrado, filtrado por homeAccountId del usuario
  let refreshToken;
  try {
    const cacheJson   = JSON.parse(_decrypt(row.ms_token_cache));
    const rtEntries   = Object.values(cacheJson.RefreshToken || {});
    // Filtrar por homeAccountId del usuario para evitar tomar el token de otro usuario
    const rtEntry     = rtEntries.find(rt => rt.homeAccountId === row.ms_home_account_id)
                        || rtEntries[0];
    refreshToken      = rtEntry?.secret;
    console.log(`[graphClient] cache: ${rtEntries.length} RT(s), usando homeAccountId=${rtEntry?.homeAccountId}`);
  } catch(e) {
    console.error('[graphClient] Error descifrando cache:', e.message);
    throw new GraphAuthError('Cache Microsoft corrupto. Vuelve a iniciar sesión.');
  }

  if (!refreshToken) {
    throw new GraphAuthError('Sin refresh token. Vuelve a iniciar sesión con Microsoft.');
  }

  // Llamar directamente al token endpoint de Microsoft usando .default (incluye todos los permisos admin-consented)
  try {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      refresh_token: refreshToken,
      scope:         'https://graph.microsoft.com/.default offline_access',
    }).toString();

    const resp = await axios.post(
      `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
      body,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Actualizar el cache con el nuevo refresh token si Microsoft devolvió uno nuevo
    if (resp.data.refresh_token && resp.data.refresh_token !== refreshToken) {
      try {
        const cacheJson = JSON.parse(_decrypt(row.ms_token_cache));
        const rtKey = Object.keys(cacheJson.RefreshToken || {})[0];
        if (rtKey) cacheJson.RefreshToken[rtKey].secret = resp.data.refresh_token;
        await dbQuery('UPDATE users SET ms_token_cache=? WHERE id=?',
          [_encrypt(JSON.stringify(cacheJson)), userId]);
      } catch(_) {}
    }

    console.log(`[graphClient] OK userId=${userId}`);
    return resp.data.access_token;
  } catch(e) {
    const err = e.response?.data;
    console.error(`[graphClient] Token refresh FAILED: ${err?.error} — ${err?.error_description || e.message}`);
    throw new GraphAuthError(`Token expirado (${err?.error || e.message}). Vuelve a iniciar sesión.`);
  }
}

async function callGraph(userId, path, { method = 'GET', body, beta = false } = {}) {
  const token   = await getAccessToken(userId);
  const base    = beta ? GRAPH_BETA : GRAPH_BASE;
  const url     = path.startsWith('http') ? path : `${base}${path}`;

  try {
    const resp = await axios({
      method,
      url,
      headers: {
        Authorization:    `Bearer ${token}`,
        'Content-Type':   'application/json',
        ConsistencyLevel: 'eventual',
      },
      data: body || undefined,
    });
    return resp.data;
  } catch (e) {
    if (e.response?.status === 401) throw new GraphAuthError('Token Graph inválido o expirado.');
    if (e.response?.status === 403) throw new GraphForbiddenError(e.response?.data?.error?.message || 'Sin permisos para este recurso.');
    const msg = e.response?.data?.error?.message || e.message;
    throw new Error(`Graph API [${path}]: ${msg}`);
  }
}

// Paginar automáticamente respuestas con @odata.nextLink
async function callGraphPaged(userId, path, { maxPages = 10, beta = false } = {}) {
  const items = [];
  let url     = path;
  let page    = 0;
  while (url && page < maxPages) {
    const data = await callGraph(userId, url, { beta });
    if (Array.isArray(data.value)) items.push(...data.value);
    url = data['@odata.nextLink'] || null;
    page++;
  }
  return items;
}

module.exports = { callGraph, callGraphPaged, getAccessToken, GraphAuthError, GraphForbiddenError, GRAPH_SCOPES };

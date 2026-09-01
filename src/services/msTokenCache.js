'use strict';

const crypto  = require('crypto');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { dbQuery } = require('../../routes/jira/helpers');

// Derivar clave AES-256 desde JWT_SECRET (mismo secreto, sin variable extra)
const _KEY = Buffer.from(
  (process.env.JWT_SECRET || 'fallback_key_change_in_production_32x').padEnd(32, '0').slice(0, 32)
);
const ALGO = 'aes-256-gcm';

function _encrypt(plain) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, _KEY, iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function _decrypt(stored) {
  const parts = stored.split(':');
  if (parts.length < 3) throw new Error('invalid_cache_format');
  const [ivHex, tagHex, encHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, _KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Crea un ConfidentialClientApplication con cache plugin respaldado en MySQL.
 * Cada llamada crea una instancia fresca pero cargada con el estado del usuario.
 */
async function createMsalForUser(userId) {
  // Cargar cache cifrado desde BD
  let cachedData = null;
  try {
    const rows = await dbQuery('SELECT ms_token_cache FROM users WHERE id=? LIMIT 1', [userId]);
    const raw  = rows?.[0]?.ms_token_cache;
    if (raw) cachedData = _decrypt(raw);
  } catch (_) { /* cache inválido o columna no existe aún → arrancar limpio */ }

  const msalClient = new ConfidentialClientApplication({
    auth: {
      clientId:     process.env.MS_CLIENT_ID,
      authority:    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
      clientSecret: process.env.MS_CLIENT_SECRET,
    },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => {
          if (cachedData) ctx.tokenCache.deserialize(cachedData);
        },
        afterCacheAccess: async (ctx) => {
          if (!ctx.cacheHasChanged) return;
          try {
            const serialized = ctx.tokenCache.serialize();
            const encrypted  = _encrypt(serialized);
            await dbQuery(
              'UPDATE users SET ms_token_cache=? WHERE id=?',
              [encrypted, userId]
            );
          } catch (e) {
            console.error('[msTokenCache] Error guardando cache:', e.message);
          }
        },
      },
    },
  });

  return msalClient;
}

module.exports = { createMsalForUser, _encrypt, _decrypt };

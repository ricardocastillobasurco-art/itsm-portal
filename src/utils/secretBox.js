'use strict';

// Cifrado de credenciales guardadas en BD (tokens, secretos, contraseñas de
// integraciones de cada tenant). AES-256-GCM con la clave CONFIG_ENCRYPTION_KEY.
//
// - Sin CONFIG_ENCRYPTION_KEY se guarda en claro (comportamiento anterior) y se avisa.
// - Los valores cifrados llevan el prefijo "enc:v1:"; los antiguos en claro se
//   siguen leyendo, y se cifran la próxima vez que se guarden.
// - La clave NO debe cambiar: los valores cifrados con otra clave no se pueden leer.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const SENSITIVE = /(token|secret|pass(word)?|api_key|apikey|private_key)$/i;

let _warned = false;
function key() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) {
    if (!_warned) { _warned = true; console.warn('⚠️ CONFIG_ENCRYPTION_KEY no definida: las credenciales de integraciones se guardan sin cifrar'); }
    return null;
  }
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

function encrypt(plain) {
  if (plain == null || plain === '' || String(plain).startsWith(PREFIX)) return plain;
  const k = key();
  if (!k) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const k = key();
  if (!k) throw new Error('CONFIG_ENCRYPTION_KEY requerida para leer credenciales cifradas');
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

const isSensitive = (field) => SENSITIVE.test(field);

// Cifra / descifra solo los campos sensibles de un objeto de configuración
function sealConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  return Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, isSensitive(k) ? encrypt(v) : v]));
}

function openConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  return Object.fromEntries(Object.entries(cfg).map(([k, v]) => {
    if (!isSensitive(k)) return [k, v];
    try { return [k, decrypt(v)]; } catch (e) { console.error(`[secretBox] no se pudo descifrar "${k}":`, e.message); return [k, '']; }
  }));
}

module.exports = { encrypt, decrypt, sealConfig, openConfig, isSensitive, PREFIX };

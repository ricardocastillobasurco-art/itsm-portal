'use strict';

// Adjuntos locales de tickets: carpeta persistente y registro en ticket_attachments.
//
// - Carpeta: <raíz>/uploads/tickets/<clave>/ (la misma que crea el Dockerfile; en Railway
//   conviene montar ahí un Volume para que los archivos sobrevivan a cada despliegue).
// - La tabla tiene columnas distintas según cómo se creó en cada instalación
//   (original/originalname, size/size_bytes, path): el INSERT usa solo las que existen,
//   así no falla en MySQL estricto por una columna obligatoria sin valor.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');

const ROOT_DIR = path.join(__dirname, '../../uploads/tickets');
const MAX_BYTES = 20 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|vbs|vbe|js|jse|ps1|psm1|sh|scr|pif|cpl|jar|hta|wsf|reg|lnk)$/i;

let _cols = null;
async function columns() {
  if (_cols) return _cols;
  const rows = await executeQuery(equipmentPool,
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_attachments'");
  _cols = new Set(rows.map(r => r.c || r.COLUMN_NAME));
  return _cols;
}

function safeOriginal(name) {
  return String(name || 'archivo').replace(/[\\/\0]/g, '_').slice(0, 200);
}

// Guarda un archivo (Buffer) de un ticket local y registra la fila. Devuelve { id, filename }.
async function saveLocalAttachment({ key, original, mimetype, buffer, userId = 0 }) {
  if (BLOCKED_EXT.test(original || '')) throw Object.assign(new Error('Tipo de archivo no permitido'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('El archivo supera 20 MB'), { status: 400 });
  const dir = path.join(ROOT_DIR, String(key).replace(/[^A-Za-z0-9_-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(original || '').replace(/[^.A-Za-z0-9]/g, '').slice(0, 10);
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, buffer);

  const cols = await columns();
  const name = safeOriginal(original);
  const row = { ticket_id: key, user_id: userId || 0, filename, mimetype: mimetype || 'application/octet-stream' };
  if (cols.has('original'))     row.original = name;
  if (cols.has('originalname')) row.originalname = name;
  if (cols.has('size_bytes'))   row.size_bytes = buffer.length;
  if (cols.has('size'))         row.size = buffer.length;
  if (cols.has('path'))         row.path = full;
  const keys = Object.keys(row).filter(k => cols.has(k));
  const r = await executeQuery(equipmentPool,
    `INSERT INTO ticket_attachments /* tenant_id: ticket padre validado por el llamador */ (${keys.map(k => `\`${k}\``).join(', ')})
     VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => row[k]));
  return { id: r.insertId, filename };
}

// Ruta absoluta de un adjunto local (soporta filas antiguas con path propio)
function localPathOf(row, key) {
  if (row.path && fs.existsSync(row.path)) return row.path;
  const candidates = [
    path.join(ROOT_DIR, String(key), row.filename || ''),
    path.join(ROOT_DIR, row.filename || ''),
  ];
  return candidates.find(p => row.filename && fs.existsSync(p)) || null;
}

module.exports = { saveLocalAttachment, localPathOf, MAX_BYTES, BLOCKED_EXT, ROOT_DIR };

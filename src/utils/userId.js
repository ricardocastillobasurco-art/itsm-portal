'use strict';

// users.id no es igual en todas las instalaciones: en bases creadas por las
// migraciones es CHAR(36) (UUID, como el modelo Sequelize User); en bases más
// antiguas es INT AUTO_INCREMENT. Al insertar un usuario con SQL directo hay que
// enviar un UUID en el primer caso y omitir la columna en el segundo.

const crypto = require('crypto');
const { executeQuery, equipmentPool } = require('../../config/database');

let _isAuto = null;

async function usersIdIsAuto() {
  if (_isAuto !== null) return _isAuto;
  const [c] = await executeQuery(equipmentPool,
    `SELECT DATA_TYPE AS t, EXTRA AS e FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'id'`);
  _isAuto = !!c && /auto_increment/i.test(c.e || c.EXTRA || '');
  return _isAuto;
}

/**
 * Columnas/valores extra para un INSERT INTO users: { cols: ['id'], vals: [uuid] }
 * o vacío si el id es autoincremental. Devuelve también el id generado (si aplica).
 */
async function newUserIdParts() {
  if (await usersIdIsAuto()) return { cols: [], vals: [], id: null };
  const id = crypto.randomUUID();
  return { cols: ['id'], vals: [id], id };
}

module.exports = { usersIdIsAuto, newUserIdParts };

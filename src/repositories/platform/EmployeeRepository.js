'use strict';

const { equipmentPool, executeQuery } = require('../../../config/database');

async function q(sql, params = []) {
  return executeQuery(equipmentPool, sql, params);
}

// Todas las operaciones reciben tenantId: ningún empleado se lee ni se modifica
// fuera del tenant del usuario que hace la petición.
class EmployeeRepository {
  // ── Reads ────────────────────────────────────────────────────────────────

  async findActive({ search = '', limit = 50, offset = 0, tenantId }) {
    if (search) {
      return q(
        `SELECT * FROM employees
         WHERE is_active = TRUE AND tenant_id = ? AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)
         ORDER BY full_name LIMIT ? OFFSET ?`,
        [tenantId, `%${search}%`, `%${search}%`, `%${search}%`, limit, offset]
      );
    }
    return q(
      'SELECT * FROM employees WHERE is_active = TRUE AND tenant_id = ? ORDER BY full_name LIMIT ? OFFSET ?',
      [tenantId, limit, offset]
    );
  }

  async countActive(tenantId) {
    const [row] = await q('SELECT COUNT(*) as total FROM employees WHERE is_active = TRUE AND tenant_id = ?', [tenantId]);
    return row.total;
  }

  async findAll(tenantId) {
    return q('SELECT * FROM employees WHERE tenant_id = ? ORDER BY is_active DESC, full_name', [tenantId]);
  }

  async findInactive(tenantId) {
    return q(
      `SELECT id, cip, national_id, full_name, email, department_id,
              position, position_name, category, employee_group,
              branch_office_id, state, supervisor_name, is_active, updated_at
       FROM employees WHERE is_active = FALSE AND tenant_id = ? ORDER BY updated_at DESC`,
      [tenantId]
    );
  }

  async search(term, limit, tenantId) {
    return q(
      `SELECT * FROM employees
       WHERE is_active = TRUE AND tenant_id = ? AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)
       ORDER BY full_name LIMIT ?`,
      [tenantId, `%${term}%`, `%${term}%`, `%${term}%`, limit]
    );
  }

  // Autocompletado de correos: empleados del tenant; si el tenant aún no cargó
  // su planilla, usa sus cuentas de usuario.
  async searchEmails(term, limit, tenantId) {
    const rows = await q(
      `SELECT DISTINCT email, full_name, cip, position_name
       FROM employees
       WHERE (email LIKE ? OR full_name LIKE ?) AND is_active = 1 AND tenant_id = ?
       ORDER BY full_name ASC LIMIT ?`,
      [`%${term}%`, `%${term}%`, tenantId, limit]
    );
    if (rows.length) return rows;
    return q(
      `SELECT email, full_name, '' AS cip, '' AS position_name
       FROM users
       WHERE COALESCE(tenant_id, 1) = ? AND is_active = 1 AND deleted_at IS NULL
         AND (full_name LIKE ? OR email LIKE ? OR username LIKE ?)
       ORDER BY full_name LIMIT ?`,
      [tenantId, `%${term}%`, `%${term}%`, `%${term}%`, limit]
    );
  }

  async countTotal(tenantId) {
    const [row] = await q('SELECT COUNT(*) AS total_empleados FROM employees WHERE tenant_id = ?', [tenantId]);
    return row.total_empleados;
  }

  async findById(id, tenantId, fields = 'id, full_name, is_active') {
    const [row] = await q(`SELECT ${fields} FROM employees WHERE id = ? AND tenant_id = ? LIMIT 1`, [id, tenantId]);
    return row || null;
  }

  async findByEmail(email, tenantId) {
    const [row] = await q('SELECT id FROM employees WHERE email = ? AND tenant_id = ? LIMIT 1', [email, tenantId]);
    return row || null;
  }

  async hasActiveAssignments(id, tenantId) {
    const [{ count }] = await q(
      'SELECT COUNT(*) as count FROM assignments WHERE employee_id = ? AND tenant_id = ? AND return_date IS NULL',
      [id, tenantId]
    );
    return count > 0;
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create({ full_name, email, cip, department_id, position, is_active }, tenantId) {
    return q(
      'INSERT INTO employees (full_name, email, cip, department_id, position, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [full_name, email, cip || null, department_id || null, position || null, is_active ? 1 : 0, tenantId]
    );
  }

  async setActive(id, is_active, deactivated_at, tenantId) {
    const useDate = !is_active && deactivated_at;
    return q(
      useDate
        ? 'UPDATE employees SET is_active = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
        : 'UPDATE employees SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?',
      useDate ? [0, deactivated_at, id, tenantId] : [is_active ? 1 : 0, id, tenantId]
    );
  }

  async toggleStatusByCip(cip, is_active, tenantId) {
    return q(
      'UPDATE employees SET is_active = ?, updated_at = NOW() WHERE cip = ? AND tenant_id = ?',
      [is_active ? 1 : 0, cip, tenantId]
    );
  }

  async softDelete(id, tenantId) {
    return q('UPDATE employees SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?', [id, tenantId]);
  }

  // ── Recovery helpers ─────────────────────────────────────────────────────

  async getActiveAssignments(employeeId, tenantId) {
    return q(
      `SELECT a.id AS assignment_id, a.equipment_id
       FROM assignments a
       WHERE a.employee_id = ? AND a.tenant_id = ? AND a.return_date IS NULL AND a.status = 'activo'`,
      [employeeId, tenantId]
    );
  }

  async existsPendingRecovery(equipmentId, tenantId) {
    const rows = await q(
      `SELECT id FROM equipment_recoveries WHERE equipment_id=? AND tenant_id = ? AND status != 'recuperado' LIMIT 1`,
      [equipmentId, tenantId]
    );
    return rows.length > 0;
  }

  async createRecovery(assignmentId, equipmentId, employeeId, tenantId) {
    return q(
      `INSERT INTO equipment_recoveries (assignment_id, equipment_id, employee_id, recovery_method, notes, tenant_id)
       VALUES (?, ?, ?, 'pendiente', 'Generado automáticamente al dar de baja', ?)`,
      [assignmentId, equipmentId, employeeId, tenantId]
    );
  }

  async createRecoveryLog(recoveryId) {
    return q(
      `INSERT INTO equipment_recovery_logs /* tenant_id: validado vía recupero padre */ (recovery_id, new_status, note)
       VALUES (?, 'por_recuperar', 'Empleado dado de baja')`,
      [recoveryId]
    );
  }

  async markEquipmentMaintenance(employeeId, tenantId) {
    return q(
      `UPDATE equipment eq
       INNER JOIN assignments a ON a.equipment_id = eq.id AND a.tenant_id = eq.tenant_id
       SET eq.status = 'En Mantenimiento'
       WHERE a.employee_id = ? AND eq.tenant_id = ? AND a.status = 'activo' AND eq.status = 'Asignado'`,
      [employeeId, tenantId]
    );
  }
}

module.exports = new EmployeeRepository();

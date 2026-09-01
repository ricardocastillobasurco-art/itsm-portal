'use strict';

const { equipmentPool, executeQuery } = require('../../../config/database');

async function q(sql, params = []) {
  return executeQuery(equipmentPool, sql, params);
}

class EmployeeRepository {
  // ── Reads ────────────────────────────────────────────────────────────────

  async findActive({ search = '', limit = 50, offset = 0, tenantId = 1 } = {}) {
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

  async countActive(tenantId = 1) {
    const [row] = await q('SELECT COUNT(*) as total FROM employees WHERE is_active = TRUE AND tenant_id = ?', [tenantId]);
    return row.total;
  }

  async findAll(tenantId = 1) {
    return q('SELECT * FROM employees WHERE tenant_id = ? ORDER BY is_active DESC, full_name', [tenantId]);
  }

  async findInactive(tenantId = 1) {
    return q(
      `SELECT id, cip, national_id, full_name, email, department_id,
              position, position_name, category, employee_group,
              branch_office_id, state, supervisor_name, is_active, updated_at
       FROM employees WHERE is_active = FALSE AND tenant_id = ? ORDER BY updated_at DESC`,
      [tenantId]
    );
  }

  async search(term, limit = 50, tenantId = 1) {
    return q(
      `SELECT * FROM employees
       WHERE is_active = TRUE AND tenant_id = ? AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)
       ORDER BY full_name LIMIT ?`,
      [tenantId, `%${term}%`, `%${term}%`, `%${term}%`, limit]
    );
  }

  async searchEmails(term, limit = 10, tenantId = 1) {
    return q(
      `SELECT DISTINCT email, full_name, cip, position_name
       FROM employees
       WHERE (email LIKE ? OR full_name LIKE ?) AND is_active = 1 AND tenant_id = ?
       ORDER BY full_name ASC LIMIT ?`,
      [`%${term}%`, `%${term}%`, tenantId, limit]
    );
  }

  async countTotal(tenantId = 1) {
    const [row] = await q('SELECT COUNT(*) AS total_empleados FROM employees WHERE tenant_id = ?', [tenantId]);
    return row.total_empleados;
  }

  async findById(id, fields = 'id, full_name, is_active') {
    const [row] = await q(`SELECT ${fields} FROM employees WHERE id = ? LIMIT 1`, [id]);
    return row || null;
  }

  async findByEmail(email) {
    const [row] = await q('SELECT id FROM employees WHERE email = ? LIMIT 1', [email]);
    return row || null;
  }

  async hasActiveAssignments(id) {
    const [{ count }] = await q(
      'SELECT COUNT(*) as count FROM assignments WHERE employee_id = ? AND return_date IS NULL',
      [id]
    );
    return count > 0;
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async create({ full_name, email, cip, department_id, position, is_active }) {
    return q(
      'INSERT INTO employees (full_name, email, cip, department_id, position, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [full_name, email, cip || null, department_id || null, position || null, is_active ? 1 : 0]
    );
  }

  async setActive(id, is_active, deactivated_at) {
    const useDate = !is_active && deactivated_at;
    return q(
      useDate
        ? 'UPDATE employees SET is_active = ?, updated_at = ? WHERE id = ?'
        : 'UPDATE employees SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      useDate ? [0, deactivated_at, id] : [is_active ? 1 : 0, id]
    );
  }

  async toggleStatusByCip(cip, is_active) {
    return q(
      'UPDATE employees SET is_active = ?, updated_at = NOW() WHERE cip = ?',
      [is_active ? 1 : 0, cip]
    );
  }

  async softDelete(id) {
    return q('UPDATE employees SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  }

  // ── Recovery helpers ─────────────────────────────────────────────────────

  async getActiveAssignments(employeeId) {
    return q(
      `SELECT a.id AS assignment_id, a.equipment_id
       FROM assignments a
       WHERE a.employee_id = ? AND a.return_date IS NULL AND a.status = 'activo'`,
      [employeeId]
    );
  }

  async existsPendingRecovery(equipmentId) {
    const rows = await q(
      `SELECT id FROM equipment_recoveries WHERE equipment_id=? AND status != 'recuperado' LIMIT 1`,
      [equipmentId]
    );
    return rows.length > 0;
  }

  async createRecovery(assignmentId, equipmentId, employeeId) {
    return q(
      `INSERT INTO equipment_recoveries (assignment_id, equipment_id, employee_id, recovery_method, notes)
       VALUES (?, ?, ?, 'pendiente', 'Generado automáticamente al dar de baja')`,
      [assignmentId, equipmentId, employeeId]
    );
  }

  async createRecoveryLog(recoveryId) {
    return q(
      `INSERT INTO equipment_recovery_logs (recovery_id, new_status, note)
       VALUES (?, 'por_recuperar', 'Empleado dado de baja')`,
      [recoveryId]
    );
  }

  async markEquipmentMaintenance(employeeId) {
    return q(
      `UPDATE equipment eq
       INNER JOIN assignments a ON a.equipment_id = eq.id
       SET eq.status = 'En Mantenimiento'
       WHERE a.employee_id = ? AND a.status = 'activo' AND eq.status = 'Asignado'`,
      [employeeId]
    );
  }
}

module.exports = new EmployeeRepository();

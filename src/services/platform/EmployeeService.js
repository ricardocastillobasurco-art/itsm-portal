'use strict';

const repo = require('../../repositories/platform/EmployeeRepository');

class EmployeeService {
  async findAll({ search = '', page = 1, limit = 50, tenantId = 1 } = {}) {
    const offset = (page - 1) * limit;
    const [employees, total] = await Promise.all([
      repo.findActive({ search, limit, offset, tenantId }),
      repo.countActive(tenantId),
    ]);
    return { employees, total };
  }

  async findAllForView(tenantId = 1) {
    return repo.findAll(tenantId);
  }

  async findInactive(tenantId = 1) {
    return repo.findInactive(tenantId);
  }

  async search(term, limit = 50, tenantId = 1) {
    return repo.search(term, limit, tenantId);
  }

  async searchEmails(term, limit = 10, tenantId = 1) {
    return repo.searchEmails(term, limit, tenantId);
  }

  async count(tenantId = 1) {
    return repo.countTotal(tenantId);
  }

  async create({ full_name, email, cip, department_id, position, is_active = true }) {
    const existing = await repo.findByEmail(email);
    if (existing) throw Object.assign(new Error('El email ya está registrado'), { status: 400 });

    const result = await repo.create({ full_name, email, cip, department_id, position, is_active });
    return { id: result.insertId, full_name, email, cip: cip || null };
  }

  async setActive(id, is_active, deactivated_at) {
    const result = await repo.setActive(id, is_active, deactivated_at);
    if (result.affectedRows === 0) throw Object.assign(new Error('Empleado no encontrado'), { status: 404 });

    if (!is_active) {
      await this._createRecoveries(id);
      await this._markEquipmentMaintenance(id);
    }

    return repo.findById(id);
  }

  async toggleStatusByCip(cip, is_active) {
    const [result] = await repo.toggleStatusByCip(cip, is_active);
    if (result && result.affectedRows === 0) throw Object.assign(new Error('Empleado no encontrado'), { status: 404 });
    return { cip, is_active: is_active ? 1 : 0 };
  }

  async deleteById(id) {
    const employee = await repo.findById(id, 'id, full_name');
    if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { status: 404 });

    const hasActive = await repo.hasActiveAssignments(id);
    if (hasActive) {
      throw Object.assign(
        new Error('No se puede eliminar un empleado con asignaciones activas'),
        { status: 400 }
      );
    }

    await repo.softDelete(id);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  async _createRecoveries(employeeId) {
    try {
      const assignments = await repo.getActiveAssignments(employeeId);
      for (const asgn of assignments) {
        const exists = await repo.existsPendingRecovery(asgn.equipment_id);
        if (exists) continue;

        const recResult = await repo.createRecovery(asgn.assignment_id, asgn.equipment_id, employeeId);
        await repo.createRecoveryLog(recResult.insertId).catch(() => {});
      }
    } catch (err) {
      console.error('⚠️  Error creando recuperos:', err.message);
    }
  }

  async _markEquipmentMaintenance(employeeId) {
    try {
      await repo.markEquipmentMaintenance(employeeId);
    } catch (err) {
      console.error('⚠️  Error actualizando estado de equipos:', err.message);
    }
  }
}

module.exports = new EmployeeService();

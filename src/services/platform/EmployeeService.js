'use strict';

const repo = require('../../repositories/platform/EmployeeRepository');

// tenantId es obligatorio en todos los métodos (viene de tenantScope.tenantId(req)).
class EmployeeService {
  async findAll({ search = '', page = 1, limit = 50, tenantId }) {
    const offset = (page - 1) * limit;
    const [employees, total] = await Promise.all([
      repo.findActive({ search, limit, offset, tenantId }),
      repo.countActive(tenantId),
    ]);
    return { employees, total };
  }

  async findAllForView(tenantId) {
    return repo.findAll(tenantId);
  }

  async findInactive(tenantId) {
    return repo.findInactive(tenantId);
  }

  async search(term, limit, tenantId) {
    return repo.search(term, limit, tenantId);
  }

  async searchEmails(term, limit, tenantId) {
    return repo.searchEmails(term, limit, tenantId);
  }

  async count(tenantId) {
    return repo.countTotal(tenantId);
  }

  async create({ full_name, email, cip, department_id, position, is_active = true }, tenantId) {
    const existing = await repo.findByEmail(email, tenantId);
    if (existing) throw Object.assign(new Error('El email ya está registrado'), { status: 400 });

    const result = await repo.create({ full_name, email, cip, department_id, position, is_active }, tenantId);
    return { id: result.insertId, full_name, email, cip: cip || null };
  }

  async setActive(id, is_active, deactivated_at, tenantId) {
    const result = await repo.setActive(id, is_active, deactivated_at, tenantId);
    if (result.affectedRows === 0) throw Object.assign(new Error('Empleado no encontrado'), { status: 404 });

    if (!is_active) {
      await this._createRecoveries(id, tenantId);
      await this._markEquipmentMaintenance(id, tenantId);
    }

    return repo.findById(id, tenantId);
  }

  async toggleStatusByCip(cip, is_active, tenantId) {
    const result = await repo.toggleStatusByCip(cip, is_active, tenantId);
    if (result && result.affectedRows === 0) throw Object.assign(new Error('Empleado no encontrado'), { status: 404 });
    return { cip, is_active: is_active ? 1 : 0 };
  }

  async deleteById(id, tenantId) {
    const employee = await repo.findById(id, tenantId, 'id, full_name');
    if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { status: 404 });

    const hasActive = await repo.hasActiveAssignments(id, tenantId);
    if (hasActive) {
      throw Object.assign(
        new Error('No se puede eliminar un empleado con asignaciones activas'),
        { status: 400 }
      );
    }

    await repo.softDelete(id, tenantId);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  async _createRecoveries(employeeId, tenantId) {
    try {
      const assignments = await repo.getActiveAssignments(employeeId, tenantId);
      for (const asgn of assignments) {
        const exists = await repo.existsPendingRecovery(asgn.equipment_id, tenantId);
        if (exists) continue;

        const recResult = await repo.createRecovery(asgn.assignment_id, asgn.equipment_id, employeeId, tenantId);
        await repo.createRecoveryLog(recResult.insertId).catch(() => {});
      }
    } catch (err) {
      console.error('⚠️  Error creando recuperos:', err.message);
    }
  }

  async _markEquipmentMaintenance(employeeId, tenantId) {
    try {
      await repo.markEquipmentMaintenance(employeeId, tenantId);
    } catch (err) {
      console.error('⚠️  Error actualizando estado de equipos:', err.message);
    }
  }
}

module.exports = new EmployeeService();

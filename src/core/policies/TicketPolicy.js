'use strict';

const { BasePolicy, ADMIN_ROLES, MANAGEMENT_ROLES } = require('./BasePolicy');

const CLOSED_STATUSES = ['cerrado', 'cancelado'];

class TicketPolicy extends BasePolicy {
  static assertRead(req, ticket) {
    this._assert(this._sameTenant(ticket, req), 'Ticket no pertenece a tu organización');

    // Usuario sin rol staff solo puede leer sus propios tickets
    if (!this._isStaff(req)) {
      this._assert(this._isOwner(ticket, req), 'Solo puedes ver tus propios tickets');
    }
  }

  static assertCreate(req) {
    // Cualquier usuario autenticado puede crear tickets
    this._assert(req.user, 'Debes estar autenticado');
  }

  static assertUpdate(req, ticket) {
    this._assert(this._sameTenant(ticket, req), 'Ticket no pertenece a tu organización');

    // Tickets cerrados/cancelados solo los puede reabrir un admin/especialista
    if (CLOSED_STATUSES.includes(ticket.status)) {
      this._assert(
        this._isManagement(req),
        'Solo administradores y especialistas pueden modificar tickets cerrados'
      );
    }

    // Usuario sin rol staff solo puede actualizar sus propios tickets (y solo campos limitados)
    if (!this._isStaff(req)) {
      this._assert(this._isOwner(ticket, req), 'Solo puedes modificar tus propios tickets');
    }
  }

  static assertAssign(req, ticket) {
    this._assert(this._sameTenant(ticket, req), 'Ticket no pertenece a tu organización');
    this._assert(this._isStaff(req), 'Solo el personal de TI puede asignar tickets');
  }

  static assertClose(req, ticket) {
    this._assert(this._sameTenant(ticket, req), 'Ticket no pertenece a tu organización');
    this._assert(this._isStaff(req), 'Solo el personal de TI puede cerrar tickets');
  }

  static assertDelete(req, ticket) {
    this._assert(this._sameTenant(ticket, req), 'Ticket no pertenece a tu organización');
    this._assert(this._isAdmin(req), 'Solo administradores pueden eliminar tickets');
  }

  static assertAddComment(req, ticket) {
    this._assert(this._sameTenant(ticket, req), 'Ticket no pertenece a tu organización');
    // Tanto staff como el creador pueden comentar
    const canComment = this._isStaff(req) || this._isOwner(ticket, req);
    this._assert(canComment, 'No puedes comentar en este ticket');
  }
}

module.exports = TicketPolicy;

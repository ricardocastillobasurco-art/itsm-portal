'use strict';

const { BasePolicy } = require('./BasePolicy');

class KnowledgePolicy extends BasePolicy {
  static assertRead(req, article) {
    this._assert(this._sameTenant(article, req), 'Artículo no pertenece a tu organización');

    // Borradores solo visibles para staff
    if (article.status === 'borrador') {
      this._assert(this._isStaff(req), 'Los borradores solo son visibles para el personal de TI');
    }
  }

  static assertCreate(req) {
    this._assert(this._isStaff(req), 'Solo el personal de TI puede crear artículos');
  }

  static assertUpdate(req, article) {
    this._assert(this._sameTenant(article, req), 'Artículo no pertenece a tu organización');
    this._assert(this._isStaff(req), 'Solo el personal de TI puede modificar artículos');

    // Artículos publicados solo los puede editar management
    if (article.status === 'publicado') {
      this._assert(this._isManagement(req), 'Solo especialistas o administradores pueden editar artículos publicados');
    }
  }

  static assertPublish(req, article) {
    this._assert(this._sameTenant(article, req), 'Artículo no pertenece a tu organización');
    this._assert(this._isManagement(req), 'Solo especialistas o administradores pueden publicar artículos');
  }

  static assertDelete(req, article) {
    this._assert(this._sameTenant(article, req), 'Artículo no pertenece a tu organización');
    this._assert(this._isAdmin(req), 'Solo administradores pueden eliminar artículos');
  }
}

module.exports = KnowledgePolicy;

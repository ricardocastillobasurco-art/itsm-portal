'use strict';

class BaseService {
  constructor(repository) {
    this.repository = repository;
  }

  async findById(id, options = {}) {
    return this.repository.findById(id, options);
  }

  async findAll(where = {}, options = {}) {
    return this.repository.findAll(where, options);
  }

  async findOne(where = {}, options = {}) {
    return this.repository.findOne(where, options);
  }

  async create(data) {
    return this.repository.create(data);
  }

  async update(id, data) {
    return this.repository.update(id, data);
  }

  async delete(id) {
    return this.repository.delete(id);
  }

  async count(where = {}) {
    return this.repository.count(where);
  }

  async findAndCountAll(where = {}, options = {}) {
    return this.repository.findAndCountAll(where, options);
  }
}

module.exports = BaseService;

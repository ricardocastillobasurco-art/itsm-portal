'use strict';

class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async findById(id, options = {}) {
    return this.model.findByPk(id, options);
  }

  async findAll(where = {}, options = {}) {
    return this.model.findAll({ where, ...options });
  }

  async findOne(where = {}, options = {}) {
    return this.model.findOne({ where, ...options });
  }

  async create(data) {
    return this.model.create(data);
  }

  async update(id, data) {
    const [count] = await this.model.update(data, { where: { id } });
    return count;
  }

  async delete(id) {
    return this.model.destroy({ where: { id } });
  }

  async count(where = {}) {
    return this.model.count({ where });
  }

  async findAndCountAll(where = {}, options = {}) {
    return this.model.findAndCountAll({ where, ...options });
  }
}

module.exports = BaseRepository;

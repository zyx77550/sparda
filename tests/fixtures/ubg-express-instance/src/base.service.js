import { knex } from './db.js';

export class BaseService {
  constructor(options = {}) {
    this.knex = options.knex || knex;
    this.collection = 'things';
  }

  async readAll(query) {
    return this.fetchAll(query);
  }

  async fetchAll() {
    return this.knex('things').select('*');
  }

  async createOne(data) {
    return this.knex('things').insert(data);
  }
}

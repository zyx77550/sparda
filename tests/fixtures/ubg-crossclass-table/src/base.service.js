import { knex } from './db.js';

// The directus shape: the table is the constructor arg, stored on this.collection,
// and every query uses this.knex(this.collection) / .from(this.collection).
export class ItemsService {
  constructor(collection, options = {}) {
    this.collection = collection;
    this.knex = options.knex || knex;
  }

  async readByQuery() {
    return this.knex.select('*').from(this.collection);
  }

  async createOne(data) {
    return this.knex(this.collection).insert(data);
  }
}

import { knex } from './db.js';

// The directus shape: the table is the constructor arg → this.collection.
export class ItemsService {
  constructor(collection) {
    this.collection = collection;
  }

  async createOne(data) {
    return knex(this.collection).insert(data);
  }
}

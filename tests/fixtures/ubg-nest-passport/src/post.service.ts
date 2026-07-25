import knexFactory from 'knex';
const db = knexFactory({ client: 'pg' });
export class PostService {
  async update(b: any) { return db('posts').insert(b); }
}

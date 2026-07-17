import knexFactory from 'knex';
const db = knexFactory({ client: 'pg' });

export class UserService {
  async findAll() {
    return db('users').select('*');
  }
  async create(input: any) {
    return db('users').insert(input);
  }
}

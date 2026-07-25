import knexFactory from 'knex';
const db = knexFactory({ client: 'pg' });

export class UserService {
  async create(input: any) {
    return db('users').insert(input);
  }
  async wipe() {
    return db('audit_log').insert({ event: 'wipe_all_users' });
  }
}

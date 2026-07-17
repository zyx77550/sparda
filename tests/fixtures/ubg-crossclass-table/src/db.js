import knexFactory from 'knex';
export const knex = knexFactory({ client: 'pg' });

// orm-breadth.test.js — the modern ORMs (Round 7 #5).
// SPARDA recognized raw SQL, Prisma, supabase/knex, Kysely, and Mongoose. This adds the
// three that a large slice of TS apps use: Drizzle (`db.insert(table).values()`, table is
// a schema IDENTIFIER not a string), TypeORM active-record (`User.save()`/`findOneBy()`),
// and Sequelize (`Product.findAll()`/`bulkCreate()`/`destroy()`). Additive by design —
// zero change to any app not using them.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-orm-breadth');

const compiled = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, findings };
})();

const effs = () =>
  compiled.graph.nodes
    .filter((n) => n.kind === 'effect')
    .map((n) => `${n.meta.effectType} ${n.meta.op} ${n.meta.table}`);

describe('ORM breadth — Drizzle / TypeORM / Sequelize', () => {
  it('reads Drizzle writes with an identifier table (db.insert(orders))', () => {
    expect(effs()).toContain('db_write insert orders');
  });

  it('reads Sequelize (bulkCreate) and TypeORM active-record (findOneBy)', () => {
    expect(effs()).toContain('db_write insert product'); // Product.bulkCreate
    expect(effs()).toContain('db_read select user'); // User.findOneBy
  });

  it('flags the unguarded ORM mutation, clears the guarded one', () => {
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded.map((f) => f.entrypoint)).toEqual(['entrypoint:POST /products']);
  });
});

// crossclass-table.test.js — cross-class symbolic dataflow (Round 7 #1, the directus win).
// The hardest table-resolution shape in real Express apps: the table is chosen at the
// route (`new ItemsService(req.params.collection, …)`), stored on `this.collection` by the
// constructor, and used deep inside inherited methods (`this.knex(this.collection)`,
// `.from(this.collection)`). Four things have to compose:
//   1. a request-derived constructor arg binds `this.collection` → `:collection` (symbolic)
//   2. a LITERAL super-arg binds a concrete table (`super('directus_activity')`)
//   3. the binding reaches inherited methods and both builder orders resolve it
//      (`this.knex(this.collection).insert` AND `this.knex.select().from(this.collection)`)
//   4. two bindings of the SAME method line coexist in the graph (no id collision)
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-crossclass-table');

const dbEffects = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  return c.nodes
    .filter((n) => n.kind === 'effect' && n.meta.effectType?.startsWith('db_'))
    .map((n) => ({ op: n.meta.op, table: n.meta.table, symbolic: !!n.meta.symbolic }));
})();

const has = (op, table, symbolic) =>
  dbEffects.some((e) => e.op === op && e.table === table && e.symbolic === symbolic);

describe('cross-class symbolic dataflow (new Service(req.x).method())', () => {
  it('binds a request-derived constructor arg → this.collection → :collection (both builder orders)', () => {
    // POST → this.knex(this.collection).insert(data)  (base-call order)
    expect(has('insert', ':collection', true)).toBe(true);
    // GET → this.knex.select(*).from(this.collection)  (verb-first order)
    expect(has('select', ':collection', true)).toBe(true);
  });

  it('binds a LITERAL super() arg → a concrete table, not a symbol', () => {
    // ActivityService extends ItemsService via super("directus_activity")
    expect(has('select', 'directus_activity', false)).toBe(true);
    expect(dbEffects.some((e) => e.table === 'directus_activity' && e.symbolic)).toBe(
      false,
    );
  });

  it('keeps two different bindings of the same method line as distinct effects', () => {
    // readByQuery (one source line) resolves to BOTH :collection and directus_activity
    const selects = dbEffects.filter((e) => e.op === 'select');
    const tables = new Set(selects.map((e) => e.table));
    expect(tables.has(':collection')).toBe(true);
    expect(tables.has('directus_activity')).toBe(true);
  });
});

// fastapi-deep.test.js — Wave 2b (ADR-054): fastapi_extract.py implements the
// resolve.js contract, so a FastAPI handler's effects follow calls OUT of the
// handler: through the module-level singleton (`Items = ItemsTable()`), through
// `self.<m>()` sibling dispatch inside the service class, and through deep-scanned
// dependencies (`Depends(get_current_user)` reads the user table — real, provable
// behavior on every route it guards). SQLAlchemy 2.0 statement builders
// (`insert(Item).values(…)`, `scalars(select(Item))`) name their table.
// Before this, open-webui read 456 routes / ZERO db effects (coverage 0%).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-fastapi-deep');
const graphOf = () => canonicalizeGraph(compileUBG(APP, { write: false }).graph);
const effectsOf = (g) => g.nodes.filter((n) => n.kind === 'effect');

describe('FastAPI deep resolution — the resolve.js contract in Python', () => {
  it('follows the module-level singleton into the service class (SA 2.0 builder table)', () => {
    // POST /items/ -> Items.insert_new_item() -> session.execute(insert(Item))
    const effects = effectsOf(graphOf());
    expect(
      effects.some(
        (n) =>
          n.meta.effectType === 'db_write' &&
          n.meta.op === 'insert' &&
          n.meta.table === 'item',
      ),
    ).toBe(true);
  });

  it('follows self.<m>() sibling dispatch inside the service', () => {
    // insert_new_item() -> self._count() -> session.execute(select(Item))
    const effects = effectsOf(graphOf());
    expect(
      effects.some(
        (n) =>
          n.meta.effectType === 'db_read' &&
          n.meta.op === 'select' &&
          n.meta.table === 'item',
      ),
    ).toBe(true);
  });

  it('deep-scans Depends() providers — the auth dep reads the users table', () => {
    const effects = effectsOf(graphOf());
    expect(
      effects.some((n) => n.meta.effectType === 'db_read' && n.meta.table === 'users'),
    ).toBe(true);
  });

  it('is deterministic — same bytes across runs', () => {
    expect(JSON.stringify(graphOf())).toBe(JSON.stringify(graphOf()));
  });
});

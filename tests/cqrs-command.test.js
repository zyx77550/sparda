// cqrs-command.test.js — a capitalized `.create()`/`.save()` receiver is a MODEL write
// only when the receiver is a model. In CQRS/DDD code it is just as often a command or
// query FACTORY (`RegisterUserCommand.create(...)`) that constructs an object and touches
// no database. Misreading those as db_writes flooded novu with 612 phantom writes (of
// 636) — poisoning its whole verdict. The gate excludes DI/CQRS infra suffixes that can
// NEVER name a real ORM model, and deliberately keeps ambiguous nouns (Event, Entity)
// as writes — dropping a real write is the one unforgivable error (SOUNDNESS Direction 1).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-cqrs-command');

const writes = (() => {
  const g = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return g.nodes
    .filter((n) => n.kind === 'effect' && n.meta.effectType === 'db_write')
    .map((n) => n.meta.table);
})();

describe('CQRS receiver disambiguation — command factories are not db_writes', () => {
  it('the real model write survives (User.create → table user)', () => {
    expect(writes).toContain('user');
  });

  it('the command factory is NOT a phantom write (RegisterUserCommand.create)', () => {
    expect(writes).not.toContain('registerusercommand');
  });

  it('the route has exactly one db_write — only the model', () => {
    expect(writes).toEqual(['user']);
  });
});

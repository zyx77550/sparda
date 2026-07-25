// o2-delete-precision.test.js — O2 (UNVALIDATED_CONSTRAINED_WRITE) must not fire on a DELETE.
// A DELETE removes a row, so it can never violate a value constraint (CHECK / NOT NULL / UNIQUE)
// — those constrain the values a row carries, not its removal. Flagging it was noise (a medium
// finding on `DELETE /members/:id` only because `members.email` is UNIQUE). An UPDATE writing
// unvalidated input to the same table MUST still flag — the precision fix keeps soundness.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-delete-constrained');

const findings = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  return checkGraph(canonicalizeGraph(graph)).findings;
})();

const o2For = (frag) =>
  findings.filter(
    (f) => f.rule === 'UNVALIDATED_CONSTRAINED_WRITE' && f.entrypoint.includes(frag),
  );

describe('O2 precision: DELETE cannot violate a value constraint', () => {
  it('does NOT flag the guarded DELETE route (was noise)', () => {
    expect(o2For('delete')).toHaveLength(0);
  });

  it('STILL flags the UPDATE writing unvalidated input to the constrained table', () => {
    expect(o2For('rename')).toHaveLength(1);
  });
});

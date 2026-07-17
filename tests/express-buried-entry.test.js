// express-buried-entry.test.js — robustness: a real Express app must never hard-fail
// just because its entry sits deep in a giant tree. Ghost (1381 files) hid its
// `core/shared/express.js` past the old flat 400-file scan budget, so a genuine Express
// app CRASHED at detection. Entry-named files (express/app/server/index/main/bootstrap)
// now get their own budget and are found at any depth. This fixture has NO standard entry
// — only a deeply-buried `express.js` — and must detect + compile, not throw.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/detect.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-express-buried');

describe('buried Express entry — never hard-fail on a giant layout', () => {
  it('finds a deeply-nested entry-named express() file', () => {
    const stack = detectStack(APP);
    expect(stack.framework).toBe('express');
    expect(stack.entryFile).toBe('lib/internal/http/core/express.js');
  });

  it('compiles it (the route in the buried factory is seen)', () => {
    const g = canonicalizeGraph(compileUBG(APP, { write: false }).graph);
    const eps = g.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id);
    expect(eps).toContain('entrypoint:GET /health');
  });
});

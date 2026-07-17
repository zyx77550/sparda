// monorepo-detect.test.js — robustness: a monorepo app dir whose framework config lives
// ELSEWHERE must not hard-fail. Ghostfolio's Nx `apps/api` has 34 @Controller files but
// only a `project.json` (its @nestjs dep is at the monorepo root), so detection — which
// reads the local package.json — found no framework and CRASHED. A purely structural last
// resort (HTTP-verb decorators on classes) now detects it. This fixture has NO package.json,
// only decorated controllers.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/detect.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-monorepo-noapkg');

describe('monorepo app with no local package.json — detect by structure, never crash', () => {
  it('detects a decorator app from its controllers alone', () => {
    expect(detectStack(APP).framework).toBe('nestjs');
  });

  it('compiles routes and resolves the DI write underneath', () => {
    const g = canonicalizeGraph(compileUBG(APP, { write: false }).graph);
    const eps = g.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id);
    expect(eps).toContain('entrypoint:POST /cats');
    const unguarded = checkGraph(g)
      .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).toContain('entrypoint:POST /cats');
  });
});

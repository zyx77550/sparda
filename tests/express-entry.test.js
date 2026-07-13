// express-entry.test.js — robust Express entry detection (the fix #4 fallback).
// The old detector only tried a fixed list of filenames (app.ts, server.ts, index.ts…),
// so a real app whose entry is named unconventionally (bootstrap.ts, application.ts,
// ParseServer.ts) hard-failed with "could not locate your Express entry". Now, when no
// named candidate matches, SPARDA scans the tree for the file that actually creates the
// app (a bare `express()` call), preferring a real server (one that `.listen()`s).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/detect.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEIRD = path.join(here, 'fixtures', 'ubg-express-weird-entry');

describe('robust Express entry detection', () => {
  it('finds a non-standard entry (src/bootstrap.ts) by its express() call', () => {
    const stack = detectStack(WEIRD);
    expect(stack.framework).toBe('express');
    expect(stack.entryFile).toBe('src/bootstrap.ts');
  });

  it('extracts real routes from the recovered entry — not a hollow detection', () => {
    const { graph, report } = compileUBG(WEIRD, { write: false });
    const c = canonicalizeGraph(graph);
    const { findings } = checkGraph(c);
    const verdict = verdictOf(findings, c);
    expect(report.routes).toBe(2); // GET /health + POST /users
    expect(verdict.surfaceOnly).toBe(false); // the guarded mutation's effect was resolved
  });
});

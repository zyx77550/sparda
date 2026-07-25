// server-actions.test.js — a Next.js server action (`'use server'`) is a remotely-invocable
// entrypoint: a client form can call an exported action with any args. SPARDA used to see only
// `route.ts` files, so an unguarded mutating action was INVISIBLE and coverage read a false 100%
// "nothing hidden" (the C3 blind spot). Server actions are now extracted as POST entrypoints and get
// the same O1 guard analysis — an unguarded one flags, a read-only one is clean, and a plain
// non-async helper in the file is NOT mistaken for an action.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-server-actions');

const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
const nodes = Array.isArray(c.nodes) ? c.nodes : Object.values(c.nodes);
const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
const actionEntrypoints = nodes.filter(
  (n) => n.kind === 'entrypoint' && /\(action\)/.test(n.label),
);
const unguarded = new Set(
  checkGraph(c)
    .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => label(f.entrypoint)),
);
const has = (re) => [...unguarded].some((l) => re.test(l));

describe('server actions — no longer an invisible mutation surface (C3)', () => {
  it('exported server actions become entrypoints (module-level AND inline `use server`)', () => {
    expect(actionEntrypoints.some((n) => /actions#deleteUser/.test(n.label))).toBe(true);
    expect(actionEntrypoints.some((n) => /inline#touchUser/.test(n.label))).toBe(true);
  });

  it('a plain non-async helper in the file is NOT mistaken for an action', () => {
    expect(actionEntrypoints.some((n) => /notAnAction/.test(n.label))).toBe(false);
  });

  it('an unguarded mutating action is now flagged (was invisible → false 100% coverage)', () => {
    expect(has(/actions#deleteUser/)).toBe(true); // module-level
    expect(has(/inline#touchUser/)).toBe(true); // inline directive
  });

  it('a read-only action carries no mutation finding', () => {
    expect(has(/listUsers/)).toBe(false);
  });
});

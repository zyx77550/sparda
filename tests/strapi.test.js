// strapi.test.js — Strapi (declarative route-table) extraction (ADR-065, Attack-Plan Task 3).
// Strapi's routes are a DATA STRUCTURE the framework reads at boot — `module.exports = { routes:
// [...] }` and `createCoreRouter(uid)` — not a route CALL, so every AST-call/decorator scan saw
// 0 routes and the whole app read as SURFACE (the genome's Strapi/directus "no-routes" gap). The
// extractor now PARTIALLY EVALUATES the registry: reads the route array as data, unrolls
// createCoreRouter to its CRUD table, resolves each `handler:'a.action'` to the controller
// method, and scans its effects. Locks:
//   1. the app stops reading 0 routes — the custom table AND the core CRUD appear,
//   2. a custom handler's cross-file effect resolves (entityService / db.query),
//   3. a core-default write is synthesized on the uid's table,
//   4. the ADR-055 posture is honest: a config.auth:false mutation flags unguarded; a
//      guarded-by-default route does not; the synthetic guard is asserted, never verified.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { detectStack } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-strapi');

const compiled = (() => {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return { graph: c, findings: checkGraph(c).findings };
})();

const labels = () =>
  compiled.graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label);
const writes = () =>
  compiled.graph.nodes.filter(
    (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
  );

describe('Strapi declarative route-table extraction', () => {
  it('detects the app as strapi', () => {
    expect(detectStack(FIX).framework).toBe('strapi');
  });

  it('stops reading 0 routes — the custom table AND the unrolled core CRUD appear', () => {
    const l = labels();
    // custom table
    expect(l).toContain('POST /articles/publish');
    // createCoreRouter → CRUD, pathed from the content-type pluralName
    expect(l).toContain('GET /articles');
    expect(l).toContain('POST /articles');
    expect(l).toContain('PUT /articles/:id');
    expect(l).toContain('DELETE /articles/:id');
    expect(l.length).toBeGreaterThanOrEqual(6);
  });

  it('resolves a custom handler cross-file to its entityService / db.query write', () => {
    const tables = writes().map((w) => `${w.meta.op} ${w.meta.table}`);
    expect(tables).toContain('update article'); // publish → strapi.entityService.update
    expect(tables).toContain('delete article'); // remove  → strapi.db.query(uid).delete
  });

  it('synthesizes the core-default create write on the uid table', () => {
    const tables = writes().map((w) => `${w.meta.op} ${w.meta.table}`);
    expect(tables).toContain('insert article');
  });

  it('flags the config.auth:false mutation as unguarded, not the guarded-by-default routes', () => {
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).toContain('entrypoint:POST /articles/publish');
    expect(unguarded).not.toContain('entrypoint:POST /articles');
  });

  it('the synthetic framework-default-auth guard is asserted, never verified', () => {
    const guards = compiled.graph.nodes.filter(
      (n) => n.kind === 'guard' && n.label === 'framework-default-auth',
    );
    expect(guards.length).toBeGreaterThan(0);
    for (const g of guards) expect(g.meta.verified).not.toBe(true);
  });
});

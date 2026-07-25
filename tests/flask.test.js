// flask.test.js — Flask is the second-largest Python web framework (the non-FastAPI half of the
// Python world), so covering it closes the biggest "a first user's stack isn't supported" gap. It
// reuses the whole Python extractor (SQLAlchemy effects, guard/deny detection, the shared UBG
// analysis) — only route DISCOVERY is Flask-specific: `@app.route(methods=[…])`, `@app.get`,
// Blueprints + `register_blueprint(url_prefix=…)`, and `@login_required` as a verified guard.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-flask');

const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
const nodes = Array.isArray(c.nodes) ? c.nodes : Object.values(c.nodes);
const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
const routes = nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label);
const unguarded = new Set(
  checkGraph(c)
    .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => label(f.entrypoint)),
);
const flagged = (re) => [...unguarded].some((l) => re.test(l));

describe('Flask — routes, blueprints, and guards flow into the UBG', () => {
  it('discovers @app.route(methods=[…]) and @app.get routes', () => {
    expect(routes.some((l) => /POST \/users$/.test(l))).toBe(true);
    expect(routes.some((l) => /GET \/health/.test(l))).toBe(true);
    expect(routes.some((l) => /DELETE \/users\//.test(l))).toBe(true);
  });

  it('mounts a Blueprint under its url_prefix (register_blueprint)', () => {
    expect(routes.some((l) => /POST \/admin\/promote/.test(l))).toBe(true);
  });

  it('an unguarded mutating route flags — on both an app route and a blueprint route', () => {
    expect(flagged(/POST \/users$/)).toBe(true); // app route, insert
    expect(flagged(/\/admin\/promote/)).toBe(true); // blueprint route, update
  });

  it('@login_required is a verified guard — the guarded delete does NOT flag', () => {
    expect(flagged(/DELETE \/users\//)).toBe(false);
  });

  it('a read-only route carries no mutation finding', () => {
    expect(flagged(/\/health/)).toBe(false);
  });
});

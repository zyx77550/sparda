// flask-cbv.test.js — Flask class-based views (MethodView + Flask-RESTful Resource) were an invisible
// mutation surface: SPARDA saw only decorator-on-function routes, so a MethodView.post() that mutated
// read as SURFACE ONLY. Now `add_url_rule(view_func=Cls.as_view())` and `add_resource(Cls, path)` are
// resolved: each HTTP-verb method becomes a route, class-level `decorators`/`method_decorators` and
// per-method auth decorators gate it. So an unguarded CBV mutation flags, a guarded one stays clean.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-flask-cbv');

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

describe('Flask CBVs — MethodView + Flask-RESTful Resource', () => {
  it('each verb method of a MethodView becomes a route (get/post/delete)', () => {
    expect(routes.some((l) => /GET \/users/.test(l))).toBe(true);
    expect(routes.some((l) => /POST \/users/.test(l))).toBe(true);
    expect(routes.some((l) => /DELETE \/users/.test(l))).toBe(true);
  });

  it('a Flask-RESTful Resource (add_resource) is discovered too', () => {
    expect(routes.some((l) => /DELETE \/tokens/.test(l))).toBe(true);
  });

  it('unguarded CBV mutations flag (post via session.add, delete via Query API)', () => {
    expect(flagged(/POST \/users/)).toBe(true);
    expect(flagged(/DELETE \/users/)).toBe(true);
  });

  it('read-only CBV method carries no mutation finding', () => {
    expect(flagged(/GET \/users/)).toBe(false);
  });

  it('a class-level decorators = [login_required] guards every method (MethodView + Resource)', () => {
    expect(flagged(/POST \/admin/)).toBe(false); // MethodView `decorators`
    expect(flagged(/DELETE \/tokens/)).toBe(false); // Flask-RESTful `method_decorators`
  });
});

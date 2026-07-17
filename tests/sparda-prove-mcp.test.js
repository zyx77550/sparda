// sparda-prove-mcp.test.js — the proof layer served live over MCP (`sparda_prove`).
// The tool lets an AI prove its own edit the moment it writes it. Its one non-negotiable
// property: it reuses `verdictState`, so it can NEVER show a verdict the CLI/badge won't —
// above all, never a bare PROVEN over an app that resolved nothing (the E-022/E-025/E-026
// false-PROVEN class). These tests pin that it stays honest and never throws.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { proveApp, BUILTIN_WORKFLOWS, mergeWorkflows } from '../src/server/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => path.join(here, 'fixtures', name);

const STATES = ['PROVEN', 'PARTIAL', 'SURFACE', 'NO_PROOF', 'RISKY', 'NOT_PROVEN'];

describe('sparda_prove (MCP): a live, honest verdict', () => {
  it('returns a well-formed verdict object', () => {
    const r = proveApp(fx('ubg-express'));
    expect(STATES).toContain(r.verdict);
    expect(typeof r.provable).toBe('boolean');
    expect(typeof r.coverage).toBe('number');
    expect(Array.isArray(r.findings)).toBe(true);
    expect(r.counts).toMatchObject({
      critical: expect.any(Number),
      high: expect.any(Number),
    });
  });

  it('every finding carries a route and a rule (actionable for an AI mid-edit)', () => {
    const r = proveApp(fx('ubg-semantics'));
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect(f.route).toBeTruthy();
      expect(f.rule).toBeTruthy();
      expect(f.severity).toBeTruthy();
    }
  });

  // The invariant. A graph with zero reachable behavior was the original false-PROVEN bug
  // (ADR-034). Served live, it must still read NO_PROOF — never a green light.
  it('never over-claims: a blind app is NO_PROOF, not PROVEN', () => {
    const r = proveApp(fx('ubg-blind'));
    expect(r.verdict).toBe('NO_PROOF');
    expect(r.provable).toBe(false);
  });

  // A clean app that resolved almost none of its surface must read SURFACE, never PROVEN —
  // the same anti-overclaim rung the badge and CLI enforce, since all three share verdictState.
  it('low coverage reads SURFACE, never a bare PROVEN', () => {
    const r = proveApp(path.join(here, '..', 'demo-app'));
    expect(r.verdict).not.toBe('PROVEN');
    expect(['SURFACE', 'NO_PROOF']).toContain(r.verdict);
  });

  // A parser gap is not a pass. An uncompilable / missing app must fail honest and loud,
  // never throw (which would surface as an opaque MCP error) and never claim provable.
  it('an uncompilable app fails honest (NO_PROOF), never throws', () => {
    const r = proveApp(fx('__does_not_exist__'));
    expect(r.verdict).toBe('NO_PROOF');
    expect(r.provable).toBe(false);
    expect(r.note).toMatch(/NOT a pass/i);
  });

  // The `route` filter narrows the finding list to what the AI just edited — but the verdict
  // must still reflect the WHOLE app, never a green light bought by hiding the rest.
  it('route filter narrows findings but never the safety claim', () => {
    const full = proveApp(fx('ubg-semantics'));
    const scoped = proveApp(fx('ubg-semantics'), { route: 'DELETE /orders' });
    expect(scoped.findings.length).toBeLessThan(full.findings.length);
    expect(scoped.findings.every((f) => /delete \/orders/i.test(f.route))).toBe(true);
    expect(scoped.verdict).toBe(full.verdict); // whole-app verdict, unchanged by the filter
    expect(scoped.scopedTo).toBe('DELETE /orders');
  });
});

// The regression check is apocalypse's edge over a plain linter: when a baseline exists,
// an edit that REMOVES a guard must surface as regression:true. Simulated end-to-end on a
// temp Express app so it exercises the real compile → diff → verdict path.
describe('sparda_prove (MCP): baseline diff catches a removed guard', () => {
  let dir;
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

  it('flags GUARD_REMOVED as a regression after the baseline was saved guarded', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-prove-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 't', main: 'src/app.js', dependencies: { express: '^4' } }),
    );
    const guarded = `const express=require('express'); const app=express();
function auth(req,res,next){ if(!req.user) return res.status(401).end(); next(); }
app.delete('/orders/:id', auth, (req,res)=>{ db.orders.delete(req.params.id); res.end(); });
module.exports=app;`;
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), guarded);

    // record the baseline from the GUARDED version
    const base = canonicalizeGraph(compileUBG(dir, { write: false }).graph);
    fs.mkdirSync(path.join(dir, '.sparda'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.sparda', 'ubg.baseline.json'),
      JSON.stringify(base),
    );

    // an AI edit drops the guard
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), guarded.replace(', auth,', ', '));

    const r = proveApp(dir);
    expect(r.baselined).toBe(true);
    const reg = r.findings.filter((f) => f.regression);
    expect(reg.length).toBeGreaterThan(0);
    expect(reg.some((f) => f.rule === 'GUARD_REMOVED')).toBe(true);
  });
});

// `prove-my-edit` is the discoverability surface for sparda_prove: a built-in MCP prompt served
// by every server, so an agent that lists prompts is told to prove its edit. The app's own
// inferred workflows (carry-over, sacred) must still win on a name clash.
describe('prove-my-edit: the built-in discoverability workflow', () => {
  it('ships a well-formed prove-my-edit workflow', () => {
    const w = BUILTIN_WORKFLOWS.find((x) => x.name === 'prove-my-edit');
    expect(w).toBeTruthy();
    expect(typeof w.description).toBe('string');
    expect(Array.isArray(w.steps) && w.steps.length).toBeGreaterThan(0);
    expect(w.steps.join(' ')).toMatch(/sparda_prove/);
  });

  it('mergeWorkflows adds the built-in when the app has none', () => {
    const names = mergeWorkflows([]).map((w) => w.name);
    expect(names).toContain('prove-my-edit');
  });

  it('an app workflow of the same name wins (carry-over is sacred)', () => {
    const app = [{ name: 'prove-my-edit', description: 'app override', steps: ['x'] }];
    const merged = mergeWorkflows(app);
    expect(merged.filter((w) => w.name === 'prove-my-edit')).toHaveLength(1);
    expect(merged.find((w) => w.name === 'prove-my-edit').description).toBe(
      'app override',
    );
  });
});

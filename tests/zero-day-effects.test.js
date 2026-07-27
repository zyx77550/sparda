// zero-day-effects.test.js — Z3, Z4 and Z6: the three ways a hole stayed hidden
// even when the route itself was visible.
//
//   Z4 — a computed member on a proven persistence handle (`prisma.note[OP]()`)
//        produced NO effect at all, so an unguarded mass delete looked like a no-op.
//   Z3 — a file that fails to PARSE lost its whole surface at risk `medium`, below
//        the bar that stops a verdict, so an app with an unparsed admin router read
//        a bare PROVEN at 66.7% coverage.
//   Z6 — a middleware mounted at a PATH (`app.use('/api', expressjwt(…))`) was
//        credited to every route: the Express twin of the Next matcher sin
//        (E-NEXT-MW), and a real false PROVEN with one VERIFIED guard.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function prove(dir) {
  const { graph, report } = compileUBG(dir, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  const verdict = verdictOf(findings, c, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  });
  return {
    state: verdictState(verdict),
    graph: c,
    report,
    findings,
    blind,
    verdict,
    eps: c.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label),
    unguarded: findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint),
  };
}

describe('Z4 — a write spelled dynamically is still a write', () => {
  const r = prove(path.join(here, 'fixtures', 'ubg-computed-write'));

  it('a computed ORM member on a proven handle emits an opaque db_write', () => {
    const opaque = r.graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta?.opaque && n.meta?.dynamicMember,
    );
    expect(opaque.length).toBe(2); // note[OP]() and ['note']['delete'+'Many']()
  });

  it('both hidden mass deletions now flag as unguarded mutations', () => {
    expect(r.unguarded).toContain('entrypoint:POST /admin/wipe');
    expect(r.unguarded).toContain('entrypoint:POST /admin/purge');
  });

  it('a computed call on a NON-database object fabricates nothing', () => {
    // `helpers[KEY]()` in GET /harmless — provenance-gated, so no phantom write
    expect(r.unguarded).not.toContain('entrypoint:GET /harmless');
  });

  it('THE ZERO-DAY: the corpus can no longer read PROVEN', () => {
    expect(r.state).toBe('NOT_PROVEN');
  });
});

describe('Z6 — a path-scoped middleware guards only its prefix', () => {
  const r = prove(path.join(here, 'fixtures', 'ubg-scoped-middleware'));

  it('a route UNDER the prefix keeps the guard credit', () => {
    expect(r.unguarded).not.toContain('entrypoint:POST /api/notes');
  });

  it('a route outside the prefix is not credited — the false PROVEN dies', () => {
    expect(r.unguarded).toContain('entrypoint:POST /admin/wipe');
    expect(r.state).toBe('NOT_PROVEN');
  });

  it('the prefix matches path SEGMENTS — /api never covers /apikeys', () => {
    expect(r.unguarded).toContain('entrypoint:POST /apikeys/rotate');
  });
});

describe('Z3 — losing a whole file is never a medium event', () => {
  // built on the fly: a clean app whose mounted admin router cannot be parsed
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-z3-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'prisma'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'z3',
      private: true,
      main: 'src/app.js',
      dependencies: { express: '^4.21.0', '@prisma/client': '^5.20.0', zod: '^3.23.0' },
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'prisma', 'schema.prisma'),
    'datasource db { provider = "postgresql"\n url = env("DB") }\nmodel Note { id String @id\n  text String }\n',
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'app.js'),
    `const express = require('express');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
app.use(express.json());
const noteSchema = z.object({ text: z.string().min(1) });
function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.post('/notes', requireAuth, async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid' });
  await prisma.note.create({ data: { text: parsed.data.text } });
  res.status(201).json({ ok: true });
});
app.use('/admin', require('./admin'));
app.listen(4805);
`,
  );
  // syntax outside the modelled grammar — the whole file is lost
  fs.writeFileSync(
    path.join(dir, 'src', 'admin.js'),
    `const express = require('express');
const router = express.Router();
const piped = value |> transform(%) |> persist(%);
router.post('/wipe', async (req, res) => { await prisma.note.deleteMany({}); res.json({}); });
module.exports = router;
`,
  );

  const r = prove(dir);

  it('the parse failure is still declared (it always was)', () => {
    expect(r.report.skipped.some((s) => /parse error/.test(s.reason))).toBe(true);
  });

  it('and it now scores HIGH, so it reaches blindHigh', () => {
    const spot = r.blind.spots.find((s) => /parse error/.test(s.label ?? ''));
    expect(spot).toBeDefined();
    expect(spot.risk).toBe('high');
    expect(r.blind.byRisk.critical + r.blind.byRisk.high).toBeGreaterThan(0);
  });

  it('THE ZERO-DAY: a lost file can no longer leave a bare PROVEN', () => {
    expect(r.state).not.toBe('PROVEN');
    expect(r.state).toBe('PARTIAL'); // proved what was seen, and says so
  });
});

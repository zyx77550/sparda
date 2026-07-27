// premise-convention.test.js — the BOOT-FREE premise oracle (ADR-082).
//
// `premise-gate.test.js` locks the runtime oracle: boot the app, diff its real route
// table against the graph. That oracle is the strongest one available and it covers
// three of seven lowerings — the other four cannot be booted from a static checkout, so
// their premise was simply never checked.
//
// For those four the routing table is a function of the project's shape, so the shape is
// a second source of truth. This file pins the two properties that make that usable:
//
//   1. it FINDS surface the analysis never claimed (otherwise it is decoration), and
//   2. it invents NOTHING on a healthy app (otherwise it costs every honest app its
//      verdict, and gets turned off within a week).
//
// (2) is the expensive property and the one that decides the design: every ambiguous
// convention — Strapi's pluralised core routers, Next's parallel slots, a computed
// controller prefix — is left OUT of the oracle rather than guessed at.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/detect.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { staticOracle, CONVENTION_ROUTED } from '../src/ubg/oracle-static.js';
import {
  verifyPremise,
  gapsAsSkipped,
  PROBEABLE,
  VERIFIABLE,
} from '../src/ubg/premise.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');
const fx = (n) => path.join(FIXTURES, n);

const premiseOf = async (dir) => {
  const stack = detectStack(dir);
  const { graph, report } = compileUBG(dir, { write: false });
  const canonical = canonicalizeGraph(graph);
  const premise = await verifyPremise(canonical, {
    framework: stack.framework,
    entryFile: stack.entryFile,
    cwd: dir,
    unknownHandlers: report.unknownHandlers,
  });
  return { canonical, report, premise };
};

describe('boot-free premise oracle — it finds what the analysis never claimed', () => {
  it('a Pages Router endpoint is a measured gap, not a blind spot', async () => {
    const dir = fx('ubg-next-premise-gap');
    const { premise } = await premiseOf(dir);
    expect(premise.available).toBe(true);
    expect(premise.oracle).toBe('convention');
    // `pages/api/legacy/purge.js` is served by Next 14 alongside the App Router and
    // SPARDA has no lowering for it. It is not a construct the analysis could not read —
    // it is a piece of the app the analysis never claimed, which is a different, worse
    // thing, and only an oracle outside the analysis can say it.
    expect(premise.gaps.map((g) => `${g.method} ${g.path}`)).toEqual([
      'GET /api/legacy/purge',
    ]);
  });

  it('the gap reaches the gate: the app cannot read PROVEN', async () => {
    const dir = fx('ubg-next-premise-gap');
    const { canonical, report, premise } = await premiseOf(dir);
    const { findings } = checkGraph(canonical);
    const blind = surveyBlindspots(canonical, {
      ...report,
      skipped: [
        ...(report.skipped ?? []),
        ...gapsAsSkipped(premise.gaps, premise.oracle),
      ],
    });
    const state = verdictState(
      verdictOf(findings, canonical, {
        coverage: blind.coverage.ratio,
        blindHigh: blind.byRisk.critical + blind.byRisk.high,
        premiseGaps: premise.gaps.length,
      }),
    );
    expect(state).toBe('PREMISE_GAP');
    // and the ledger says WHICH oracle saw it — a reader must be able to tell a claim
    // backed by a running app from one backed by a directory layout
    const spot = blind.spots.find((s) => /premise gap/.test(s.label ?? ''));
    expect(spot.risk).toBe('critical');
    expect(spot.label).toMatch(/file conventions serve GET \/api\/legacy\/purge/);
  });

  it('an `app/` directory named like build output is still a URL segment', () => {
    // `app/dist/route.js` is served by Next at /dist — `dist` means nothing to the
    // router. The extractor's directory filter used to drop it with no route, no skip
    // and no unknown handler: invisible on all three channels at once.
    const { routes } = staticOracle(fx('ubg-next-premise-gap'), {
      framework: 'nextjs',
      entryFile: 'app',
    });
    expect(routes.map((r) => `${r.method} ${r.path}`)).toContain('DELETE /dist');
    const { report } = compileUBG(fx('ubg-next-premise-gap'), { write: false });
    expect(report.routes).toBeGreaterThanOrEqual(2);
  });

  it('every fixture file this suite reads is tracked by git', () => {
    // The repo ignored `dist/` unanchored, so `app/dist/route.js` — the ONE file the
    // assertion above exists for — was silently untracked: green here, absent from a
    // fresh clone, and the test would have passed by reading a file CI never gets.
    // A fixture that is not committed is not a fixture.
    const tracked = new Set(
      execFileSync('git', ['ls-files', 'tests/fixtures'], {
        cwd: path.join(here, '..'),
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean),
    );
    const onDisk = [];
    const walkDisk = (dir) => {
      for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, it.name);
        // run artefacts the suite itself writes into the corpus (`__pycache__` from the
        // Python parser, `.sparda/` from an immunity capsule) are correctly untracked
        if (it.name === '__pycache__' || it.name.startsWith('.')) continue;
        if (it.isDirectory()) walkDisk(abs);
        else
          onDisk.push(
            path.relative(path.join(here, '..'), abs).split(path.sep).join('/'),
          );
      }
    };
    walkDisk(FIXTURES);
    expect(onDisk.filter((f) => !tracked.has(f))).toEqual([]);
  });
});

describe('boot-free premise oracle — and it invents nothing', () => {
  // Every convention-routed fixture in the corpus, swept. A false gap here is worse than
  // a missing feature: it takes the verdict away from an app that deserved it.
  const fixtures = fs
    .readdirSync(FIXTURES)
    .sort()
    .map((name) => ({ name, dir: path.join(FIXTURES, name) }))
    .filter((f) => {
      if (!fs.statSync(f.dir).isDirectory()) return false;
      try {
        f.stack = detectStack(f.dir);
      } catch {
        return false;
      }
      return CONVENTION_ROUTED.has(f.stack.framework);
    });

  it('the sweep covers all four convention-routed lowerings', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect([...new Set(fixtures.map((f) => f.stack.framework))].sort()).toEqual([
      'medusa',
      'nestjs',
      'nextjs',
      'strapi',
    ]);
  });

  for (const f of fixtures) {
    if (f.name === 'ubg-next-premise-gap') continue; // the one fixture built to have a gap
    it(`${f.name}: zero premise gaps`, async () => {
      const { premise } = await premiseOf(f.dir);
      expect({ [f.name]: premise.gaps.map((g) => `${g.method} ${g.path}`) }).toEqual({
        [f.name]: [],
      });
    });
  }
});

describe('boot-free premise oracle — the honest boundaries', () => {
  it('an oracle that enumerated nothing is UNAVAILABLE, never a clean bill of health', async () => {
    // A GraphQL-only Nest app has no `@Controller` URL table for the conventions to
    // read. Reading that silence as "no gaps" would let an oracle that does not work
    // confirm every proof — the same trap the empty-probe rule closes for the runtime one.
    const { premise } = await premiseOf(fx('ubg-graphql-resolver'));
    expect(premise.available).toBe(false);
    expect(premise.gaps).toEqual([]);
    expect(premise.reason).toMatch(/enumerated no routes/);
  });

  it('a computed controller prefix is declined, not placed at a guessed URL', () => {
    // The oracle must never invent a path. A prefix it cannot read moves every route
    // under it, so those routes are simply not claimed — the extractor's own unknown
    // handler carries them instead.
    const { routes } = staticOracle(fx('ubg-nest-all-verb'), {
      framework: 'nestjs',
      entryFile: 'src',
    });
    for (const r of routes) expect(r.path).not.toMatch(/undefined|\[object/);
  });

  it('OpenAPI has no oracle and never will — the spec IS the premise', () => {
    expect(VERIFIABLE.has('openapi')).toBe(false);
    const res = staticOracle(fx('ubg-openapi'), {
      framework: 'openapi',
      entryFile: 'openapi.json',
    });
    expect(res.available).toBe(false);
  });

  it('every lowering except OpenAPI now has a premise oracle', () => {
    for (const f of [
      'express',
      'fastapi',
      'flask',
      'nextjs',
      'medusa',
      'strapi',
      'nestjs',
    ])
      expect({ [f]: VERIFIABLE.has(f) }).toEqual({ [f]: true });
    // and the runtime oracle's membership is unchanged — adding a framework to it is a
    // claim that the probe can boot it, which only a real app can settle
    expect([...PROBEABLE].sort()).toEqual(['express', 'fastapi', 'flask']);
  });

  it('a declared unknown handler is not double-counted as a gap', async () => {
    // `export const POST = registry.createOrder` is declared by the Medusa extractor at
    // high risk. The conventions also see POST exported. Reporting it twice under two
    // names inflates the count and teaches a reader to discount both.
    const { premise, report } = await premiseOf(fx('ubg-medusa-ghost'));
    expect(report.unknownHandlers.length).toBe(1);
    expect(premise.gaps).toEqual([]);
    // the suppression is keyed on file AND verb: the same module's readable GET is still
    // checked, so one unreadable export cannot blind the oracle to the whole file
    expect(premise.probed).toBe(1);
  });
});

// irreversible-per-route.test.js — one finding per ROUTE, not per effect node (ADR-086).
//
// Measured on twenty: 28 high findings across 14 routes, and ONE route carried 12 of
// them. `POST /graphql/sendEmail` resolves, through a provider-strategy DI graph, into
// Gmail / Microsoft / IMAP-SMTP / email-group senders — each its own effect node, each
// reporting the SAME missing compensation path. Nearly half the app's high findings were
// one problem counted twelve times.
//
// This is `collapseFloods`'s argument (ADR-071 — a signal that repeats loses contrast)
// applied at the ROUTE level instead of the codebase level. The remediation is per route
// — wrap the send and the write, or add an undo — never per leaf, so per leaf was never
// the honest unit.
//
// It is a CONTRAST fix, not a suppression, and the difference is what these tests pin:
// the same routes stay flagged, at the same severity, gating exactly as before. Only the
// count changes, and every call survives in the message and the evidence.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, 'fixtures', n);
const FIX = fx('ubg-irreversible-fanout');

const { graph, report } = compileUBG(FIX, { write: false });
const canonical = canonicalizeGraph(graph);
const { findings } = checkGraph(canonical);
const irreversible = findings.filter((f) => f.rule === 'IRREVERSIBLE_OBSERVABLE');
const on = (route) => irreversible.filter((f) => f.entrypoint.endsWith(route));

describe('a DI fan-out is one problem, not one per leaf', () => {
  it('six sender leaves on one route yield ONE finding', () => {
    expect(on('/messaging/send')).toHaveLength(1);
  });

  it('and every leaf survives in the evidence — nothing is dropped', () => {
    // The collapse must not lose an effect: Direction 1 says an effect the program can
    // execute is either in the graph or traced. Here it is BOTH — still in the graph,
    // and named in the finding.
    const [f] = on('/messaging/send');
    expect(f.evidence.length).toBeGreaterThanOrEqual(6);
    expect(f.message).toMatch(/6 irreversible external calls/);
    // the calls are NAMED, not just counted
    expect(f.message).toMatch(/sendmessage|sendmail/i);
  });

  it('the severity is the strongest of the collapsed set, so the gate is unchanged', () => {
    const [f] = on('/messaging/send');
    expect(f.severity).toBe('high');
    expect(f.advisory).toBeUndefined();
  });
});

describe('the collapse is per ROUTE, never across routes', () => {
  it('a second route with its own irreversible call keeps its own finding', () => {
    // If the collapse were global, `charge` would be folded into `send` and a whole
    // route would stop being named — which is the failure this must not become.
    expect(on('/messaging/charge')).toHaveLength(1);
    expect(on('/messaging/charge')[0].message).toMatch(/stripe\.invoices\.pay/);
  });

  it('every route that has an external call is still flagged', () => {
    const flagged = new Set(irreversible.map((f) => f.entrypoint));
    expect(flagged.size).toBe(3);
    expect(report.routes).toBe(3);
  });
});

describe('it withholds nothing from the verdict', () => {
  it('the app still cannot read PROVEN', () => {
    const blind = surveyBlindspots(canonical, report);
    const state = verdictState(
      verdictOf(findings, canonical, {
        coverage: blind.coverage.ratio,
        blindHigh: blind.byRisk.critical + blind.byRisk.high,
      }),
    );
    expect(state).not.toBe('PROVEN');
  });

  it('a route with ONLY generic external calls stays advisory, never promoted', () => {
    // The innate-immunity rung (ADR-072) must survive the collapse. `/messaging/sync`
    // makes TWO plain fetches and a write: collapsing them may change the COUNT, never
    // the CLASS. Promoting it would turn an "we cannot prove this is irreversible" into
    // a gate — inventing danger, which is as dishonest as hiding it.
    const [sync] = on('/messaging/sync');
    expect(sync).toBeTruthy();
    expect(sync.severity).toBe('info');
    expect(sync.advisory).toBe(true);
    expect(sync.evidence).toHaveLength(2); // both fetches kept
    expect(sync.message).toMatch(/2 external calls/);
    for (const f of irreversible.filter((x) => x.severity === 'info'))
      expect(f.advisory).toBe(true);
  });
});

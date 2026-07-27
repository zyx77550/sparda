// witness.test.js — the GENERATOR half of generate-and-check (ADR-074), closed as a loop:
// an untrusted generator (the MCP client's LLM via sampling, or the calling agent itself)
// proposes WHERE an O7/BOLA advisory's ownership check lives; SPARDA's deterministic verifier
// re-proves the claim against the AST and admits or rejects it. Soundness never comes from
// the generator — these tests pin every rejection path an adversarial generator would probe:
// a fabricated location, an unreachable-but-real check (attribution tether), a path traversal,
// an unmatched route. Fixture: a route whose REAL check sits behind a variable indirection the
// static resolver does not follow (the exact recall gap the generator exists to close).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWitnessAt } from '../src/ubg/witness.js';
import { witnessApp } from '../src/server/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, 'fixtures', 'ubg-bola-generator');
const helperDir = path.join(here, 'fixtures', 'ubg-bola-witness-helper');

// locate a marker line in a fixture source (1-based) so the tests never carry brittle
// hard-coded line numbers
const lineOf = (dir, rel, marker) => {
  const lines = fs.readFileSync(path.join(dir, rel), 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(marker));
  if (idx < 0) throw new Error(`marker not found: ${marker}`);
  return idx + 1;
};

describe('sparda_witness (MCP): the generate-and-check loop for O7/BOLA', () => {
  it('with no hints, lists the advisory targets — the prompt material for any generator', () => {
    const r = witnessApp(appDir);
    expect(r.advisories).toBe(2);
    const routes = r.targets.map((t) => t.route);
    expect(routes.some((x) => x.includes('/docs'))).toBe(true);
    expect(routes.some((x) => x.includes('/leak'))).toBe(true);
  });

  it('ADMITS a hint whose location the verifier re-proves (indirection-reached real check)', () => {
    const line = lineOf(appDir, 'src/guards.js', 'row.ownerId !== user.id');
    const r = witnessApp(appDir, {
      hints: [{ route: '/docs', file: 'src/guards.js', line }],
    });
    expect(r.audits[0]).toMatchObject({
      verified: true,
      via: 'inline-compare',
      witnessVia: 'generator+verified',
    });
    expect(r.discharged.some((x) => x.includes('/docs'))).toBe(true);
    expect(r.remaining.some((x) => x.includes('/leak'))).toBe(true);
  });

  it('REJECTS a hint at a location holding no witness (fabricated proposal)', () => {
    const line = lineOf(appDir, 'src/app.js', 'res.json(row);');
    const r = witnessApp(appDir, {
      hints: [{ route: '/leak', file: 'src/app.js', line }],
    });
    expect(r.audits[0].verified).toBe(false);
    expect(r.audits[0].reason).toBe('no-witness-at-location');
    expect(r.remaining.some((x) => x.includes('/leak'))).toBe(true);
  });

  it('REJECTS a REAL check the route cannot reach (attribution tether, one-hop imports)', () => {
    // unrelated.js holds a structurally-valid check, but no route imports it — an
    // adversarial generator pointing /leak there must not clear the advisory
    const line = lineOf(appDir, 'src/unrelated.js', 'doc.ownerId !== user.id');
    const r = witnessApp(appDir, {
      hints: [{ route: '/leak', file: 'src/unrelated.js', line }],
    });
    expect(r.audits[0].verified).toBe(false);
    expect(r.audits[0].reason).toBe('not-tethered-to-route');
    expect(r.discharged).toEqual([]);
  });

  it('REJECTS an unmatched route claim', () => {
    const r = witnessApp(appDir, {
      hints: [{ route: '/nothere', file: 'src/guards.js', line: 1 }],
    });
    expect(r.audits[0].reason).toBe('no-matching-advisory');
  });
});

describe('verifyWitnessAt: the deterministic judge, alone', () => {
  it('recognizes the helper-call form at a call-site line', () => {
    const line = lineOf(
      helperDir,
      'src/app.js',
      'assertOwner(row.ownerId, req.user.id);',
    );
    expect(verifyWitnessAt(helperDir, 'src/app.js', line)).toMatchObject({
      verified: true,
      via: 'helper-call',
    });
  });

  it('rejects a spoof call site (identity handed in is req.body)', () => {
    const line = lineOf(
      helperDir,
      'src/app.js',
      'assertOwner(row.ownerId, req.body.userId);',
    );
    expect(verifyWitnessAt(helperDir, 'src/app.js', line).verified).toBe(false);
  });

  it('never opens a file outside the app dir (hostile hint)', () => {
    expect(verifyWitnessAt(appDir, '../../../etc/passwd', 1)).toMatchObject({
      verified: false,
      reason: 'outside-app-dir',
    });
  });

  it('fails closed on a missing file or malformed input', () => {
    expect(verifyWitnessAt(appDir, 'src/ghost.js', 1).verified).toBe(false);
    expect(verifyWitnessAt(appDir, '', 1).verified).toBe(false);
    expect(verifyWitnessAt(appDir, 'src/app.js', -4).verified).toBe(false);
    expect(verifyWitnessAt(appDir, 'src/app.js', 1.5).verified).toBe(false);
  });
});

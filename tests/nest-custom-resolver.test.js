// nest-custom-resolver.test.js — house decorator BRANDS and array paths (ADR-085).
//
// The mission was "twenty is one rule away from a clean verdict — 14×
// IRREVERSIBLE_OBSERVABLE". The measurement said otherwise, and the framing was an
// artefact of near-total blindness:
//
//   SPARDA parsed 33 of twenty's 6090 files. It saw 147 of its 579 routes — 25 %.
//
// Two causes, both about reading a NAME instead of a SHAPE:
//
//   1. the file pre-filter matched a fixed decorator vocabulary. twenty registers 54
//      GraphQL resolvers as `@MetadataResolver` / `@CoreResolver` / `@AdminResolver` and
//      exactly ONE as `@Resolver`, so 95 route-bearing files were never opened. A file
//      that is never opened produces no route, no skip and no unknown handler — the one
//      shape of loss no self-reported coverage number can show (Direction 3).
//   2. `@Post(['a','b'])` is ONE decorator registering TWO routes. Reading `args[0]` saw
//      an ArrayExpression, judged it "not a literal", and fell back to the controller
//      prefix — collapsing four array-pathed webhook controllers onto a phantom `POST /`,
//      the route that carried the two findings holding twenty's verdict.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNest } from '../src/ubg/nestjs.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-custom-resolver');
const out = extractNest(FIX, 'src');
const paths = out.routes.map((r) => `${r.method} ${r.path}`).sort();

describe('a house resolver brand is still a resolver', () => {
  it('`@MetadataResolver` registers its operations', () => {
    // The whole point: an exact-name check for `Resolver` finds twenty's ONE bare
    // resolver and misses its 54 branded ones.
    expect(paths).toContain('post /graphql/deleteCurrentWorkspace');
  });

  it('and the operation it exposes is graded like any other route', () => {
    const { graph } = compileUBG(FIX, { write: false });
    const { findings } = checkGraph(canonicalizeGraph(graph));
    const saga = findings.find((f) => /deleteCurrentWorkspace/.test(f.entrypoint));
    // The route cancels a Stripe subscription — irreversible, outside any transaction —
    // then soft-deletes the workspace. If the write fails, the customer has no
    // subscription and a live workspace. Invisible for as long as the file went unopened.
    expect(saga).toBeTruthy();
    expect(saga.rule).toBe('IRREVERSIBLE_OBSERVABLE');
    expect(saga.severity).toBe('high');
  });
});

describe('an array path registers EVERY route it names', () => {
  it('`@Post([a, b])` yields two routes, not one and not a phantom prefix', () => {
    expect(paths).toContain('post /webhooks/stripe');
    expect(paths).toContain('post /webhooks/stripe/legacy');
    // and no fallback-to-prefix ghost
    expect(paths).not.toContain('post /');
  });

  it('taking only the first element would lose a live endpoint — it does not', () => {
    // This is the trap in the obvious implementation: `elements.find(isStringLiteral)`
    // reads one path and silently drops the rest, which is the registration invariant
    // (ADR-079) violated by the very change that was meant to honour it.
    const stripe = out.routes.filter((r) => r.path.startsWith('/webhooks/stripe'));
    expect(stripe).toHaveLength(2);
    // each carries its own params, computed from ITS path
    for (const r of stripe) expect(r.params).toEqual([]);
  });

  it('an unreadable ELEMENT is declared, while its readable sibling still routes', () => {
    // A mixed array is the hard case: one element resolves, one does not. Routing the
    // readable one and declaring the other is the only reading that neither loses a
    // route nor invents one.
    expect(paths).toContain('post /webhooks/ok');
    const decl = out.skipped.find((s) => /dynamic path/.test(s.reason));
    expect(decl).toBeTruthy();
    expect(decl.risk).toBe('high');
    expect(out.unknownHandlers.map((u) => u.via)).toContain(
      'dynamic-decorator-path:post',
    );
  });
});

describe('the pre-filter widens without swallowing the tree', () => {
  it('matches brands by SUFFIX, not by a fixed vocabulary', () => {
    const text = fs.readFileSync(
      path.join(here, '..', 'src', 'ubg', 'nestjs.js'),
      'utf8',
    );
    const m = text.match(/const CANDIDATE_RE =\s*\n?\s*(\/.*\/);/);
    expect(m).toBeTruthy();
    const re = new RegExp(m[1].slice(1, -1));
    expect(re.test('@MetadataResolver(() => X)')).toBe(true);
    expect(re.test('@CoreResolver()')).toBe(true);
    expect(re.test('@AdminController()')).toBe(true);
    expect(re.test('@Post()')).toBe(true);
    // NOT widened to Mutation/Query/Subscription: those are also PARAMETER decorators
    // (`@Query('id') id: string`) in ordinary REST controllers, and on twenty they buy
    // one extra file out of 6090 — a class exposing a GraphQL operation carries a
    // Resolver-suffixed brand, which the suffix already catches.
    expect(re.test('  @Query() q: string')).toBe(false);
    expect(re.test('@Injectable()')).toBe(false);
    expect(re.test('@Entity()')).toBe(false);
  });
});

// param-auth-decorator.test.js — custom principal-injection PARAMETER decorators as guards
// (ADR-063, Attack Plan Task 1). twenty and countless DI/GraphQL Nest apps express auth
// not with @UseGuards but with a custom param decorator — `createUser(@AuthWorkspace() ws)`
// — that injects the authenticated principal. These live on the METHOD PARAMETERS, so the
// old useGuards() scan never saw them, and every such mutation cried a FALSE
// UNGUARDED_MUTATION (the 0/83 genome-recall bottleneck). Now the extractor reads them as
// an ASSERTED guard. This locks the whole honesty contract of that modeling:
//   1. an @AuthWorkspace()-guarded mutation is NOT flagged unguarded,
//   2. a BARE-principal @GetUser() (no auth/session token in its name) is honored too,
//   3. a mutation with NO auth param is STILL flagged (no false suppression),
//   4. the asserted guards NEVER read `verified` — no false PROVEN is ever bought.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, diffGraphs } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-param-auth-decorator');

const compiled = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, findings, verdict: verdictOf(findings, c) };
})();

const unguardedEps = () =>
  compiled.findings
    .filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

describe('principal-injection param decorators as asserted guards', () => {
  it('extracts all three resolver mutations', () => {
    const labels = compiled.graph.nodes
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => n.label);
    expect(labels).toContain('POST /graphql/createUser');
    expect(labels).toContain('POST /graphql/touchUser');
    expect(labels).toContain('POST /graphql/wipeAllUsers');
  });

  it('does NOT flag the @AuthWorkspace()-guarded mutation as unguarded', () => {
    expect(unguardedEps()).not.toContain('entrypoint:POST /graphql/createUser');
  });

  it('honors a BARE-principal @GetUser() param decorator via the assertedGuard marker', () => {
    expect(unguardedEps()).not.toContain('entrypoint:POST /graphql/touchUser');
    // the guard node exists and gates the handler
    const guards = compiled.graph.nodes.filter(
      (n) => n.kind === 'guard' && n.label === 'GetUser',
    );
    expect(guards.length).toBe(1);
  });

  it('STILL flags the mutation with no auth param (never suppresses a real hole)', () => {
    expect(unguardedEps()).toContain('entrypoint:POST /graphql/wipeAllUsers');
  });

  it('does NOT treat the @Author DECOY as a guard (BODY reads user input, not the principal)', () => {
    // @Author's body reads request.body.author — user input, not the authenticated principal.
    // Behaviour proves it is NOT a guard, so it must not suppress the unguarded finding
    // (SOUNDNESS Direction 2: never hide a hole). E-060 fixed at the root, not by name.
    expect(unguardedEps()).toContain('entrypoint:POST /graphql/authorWrite');
    const authorGuards = compiled.graph.nodes.filter(
      (n) => n.kind === 'guard' && n.label === 'Author',
    );
    expect(authorGuards.length).toBe(0);
  });

  it('DOES treat @Whoami as a guard — its BODY reads request.user though its NAME has no auth token', () => {
    // the recall a name-match can never achieve: behaviour proves the principal injection.
    expect(unguardedEps()).not.toContain('entrypoint:POST /graphql/whoamiWrite');
    const guards = compiled.graph.nodes.filter(
      (n) => n.kind === 'guard' && n.label === 'Whoami',
    );
    expect(guards.length).toBe(1);
  });

  it('the asserted param guards are never `verified` — no false PROVEN', () => {
    const paramGuards = compiled.graph.nodes.filter(
      (n) => n.kind === 'guard' && (n.label === 'AuthWorkspace' || n.label === 'GetUser'),
    );
    expect(paramGuards.length).toBe(2);
    for (const g of paramGuards) expect(g.meta.verified).not.toBe(true);
  });

  // The compass (Attack Plan Task 0): removing the @AuthWorkspace() param decorator is now
  // re-derived as a GUARD_REMOVED delta — the exact `re-derived` verdict the genome miner
  // scores. Before this change the decorator was invisible, so `fix` and `vuln` graphs were
  // identical (both unguarded) → no diff → `missed`. This IS the recall lift, deterministic
  // and network-free: the miner's core computation (diffGraphs → GUARD_REMOVED) now fires
  // on the principal-injection idiom that was twenty's #1 blind spot.
  it('re-derives GUARD_REMOVED when the param decorator is removed (miner recall lift)', () => {
    const fixGraph = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'param-auth-vuln-'));
    try {
      fs.cpSync(FIX, tmp, { recursive: true });
      const rf = path.join(tmp, 'src', 'user.resolver.ts');
      const vulnSrc = fs
        .readFileSync(rf, 'utf8')
        .replace('@AuthWorkspace() workspace: any, ', '')
        .replace('{ ...input, workspaceId: workspace.id }', '{ ...input }');
      fs.writeFileSync(rf, vulnSrc);
      const vulnGraph = canonicalizeGraph(compileUBG(tmp, { write: false }).graph);
      const rules = diffGraphs(fixGraph, vulnGraph).findings.map((f) => f.rule);
      expect(rules).toContain('GUARD_REMOVED');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

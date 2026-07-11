// commands/review.js — the SEMANTIC diff of a pull request (roadmap R5/M3).
// Everyone diffs a PR's TEXT; nobody diffs its BEHAVIOR. `sparda review` compiles
// the base ref and the working tree to the UBG and answers, with zero config and
// zero spec written by hand: what endpoints did this change add or remove, whose
// blast radius grew, which guard or invariant did it drop, and what new provable
// risk did it introduce. It is `apocalypse` made relative — the baseline is git,
// not a file you remembered to save. Composes the existing prover passes
// (checkGraph/diffGraphs/verdictOf) over two graphs, so every word is a
// counterexample, never a heuristic.
//   sparda review                 diff the working tree against the default base
//   sparda review --base main     pick the base ref explicitly
//   sparda review --json          machine-readable envelope
//   sparda review --markdown      a PR-comment-ready block
// Exit code 1 on any critical/high — drop it in CI between "tests pass" and "merge".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph, cmp } from '../ubg/schema.js';
import { checkGraph, diffGraphs, verdictOf } from '../ubg/apocalypse.js';

const ICONS = { critical: '✗', high: '✗', medium: '⚠', info: '·' };
const err = (message, hint) => Object.assign(new Error(message), { code: 'USER', hint });

// A finding's stable identity, so a risk the base already had is never re-blamed
// on this PR (introduced = present now, absent in the base).
const findingKey = (f) => `${f.rule}|${f.entrypoint}`;
const entrypointsOf = (graph) =>
  graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id);

// ---------------------------------------------------------------------------
// Pure core — two canonical graphs in, a review out. No git, no disk, no LLM.
// ---------------------------------------------------------------------------
export function reviewGraphs(baseGraph, candidateGraph) {
  // protections this deploy REMOVED (guards, invariants, entrypoints, blast radius)
  const removed = diffGraphs(baseGraph, candidateGraph).findings;

  // provable risks this deploy INTRODUCED: static findings now, minus the ones the
  // base already carried (a pre-existing sin is not this PR's fault).
  const { findings: candStatic, obligations } = checkGraph(candidateGraph);
  const baseKeys = new Set(checkGraph(baseGraph).findings.map(findingKey));
  const introduced = candStatic.filter((f) => !baseKeys.has(findingKey(f)));

  // union, de-duped by (rule, entrypoint) — a removed guard can surface both as
  // GUARD_REMOVED (diff) and UNGUARDED_MUTATION (static); keep the strongest once.
  const byKey = new Map();
  for (const f of [...removed, ...introduced]) {
    const k = findingKey(f);
    if (!byKey.has(k)) byKey.set(k, f);
  }
  const findings = [...byKey.values()].sort(
    (a, b) => rank(a.severity) - rank(b.severity) || cmp(findingKey(a), findingKey(b)),
  );

  const baseEps = new Set(entrypointsOf(baseGraph));
  const candEps = new Set(entrypointsOf(candidateGraph));
  const added = [...candEps].filter((e) => !baseEps.has(e)).sort(cmp);
  const removedEps = [...baseEps].filter((e) => !candEps.has(e)).sort(cmp);

  return {
    verdict: verdictOf(findings, candidateGraph),
    obligations,
    findings,
    endpoints: { added, removed: removedEps },
  };
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, info: 3 };
const rank = (s) => SEVERITY_RANK[s] ?? 9;

// ---------------------------------------------------------------------------
// Orchestration — resolve a base ref, compile it in an isolated git worktree,
// compile the working tree, review, render.
// ---------------------------------------------------------------------------
export async function runReview(opts) {
  const cwd = opts.cwd;
  const base = resolveBase(cwd, opts.base);

  const candidate = canonicalizeGraph(
    compileUBG(cwd, { write: false, openapi: opts.openapi }).graph,
  );
  const baseGraph = compileAtRef(cwd, base, opts);

  const review = { base, ...reviewGraphs(baseGraph, candidate) };

  if (opts.json) console.log(JSON.stringify(review, null, 2));
  else if (opts.markdown) console.log(renderMarkdown(review));
  else renderHuman(review);

  if (!review.verdict.safe) process.exitCode = 1; // CI gate
  return review;
}

// First base ref that resolves. Explicit --base wins; otherwise the usual PR
// targets, newest-intent first, falling back to the previous commit.
function resolveBase(cwd, explicit) {
  const candidates = explicit
    ? [explicit]
    : ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master', 'HEAD~1'];
  for (const ref of candidates) {
    try {
      execFileSync(
        'git',
        ['-C', cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        {
          stdio: 'pipe',
        },
      );
      return ref;
    } catch {
      /* try the next candidate */
    }
  }
  throw err(
    explicit ? `base ref '${explicit}' not found` : 'could not resolve a base ref',
    'run inside a git repo and pass one with --base <ref> (e.g. --base main)',
  );
}

// Compile the tree AT a git ref without disturbing the working tree: a detached
// worktree, compiled, then removed. Static compile — no npm install needed.
function compileAtRef(cwd, ref, opts) {
  const tmp = path.join(os.tmpdir(), `sparda-review-${process.pid}-${Date.now()}`);
  try {
    execFileSync('git', ['-C', cwd, 'worktree', 'add', '--detach', '--quiet', tmp, ref], {
      stdio: 'pipe',
    });
  } catch (e) {
    throw err(
      `could not check out base ref '${ref}': ${String(e.stderr ?? e.message).trim()}`,
      'ensure the ref exists (e.g. `git fetch origin main`) or pass --base <ref>',
    );
  }
  try {
    return canonicalizeGraph(
      compileUBG(tmp, { write: false, openapi: opts.openapi }).graph,
    );
  } finally {
    try {
      execFileSync('git', ['-C', cwd, 'worktree', 'remove', '--force', tmp], {
        stdio: 'pipe',
      });
    } catch {
      /* best effort */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------
function renderHuman(r) {
  const { verdict: v, findings, endpoints } = r;
  console.log(`REVIEW — behavior diff of the working tree vs ${r.base}`);
  if (endpoints.added.length)
    console.log(`  + new endpoints: ${endpoints.added.map(shortEp).join(', ')}`);
  if (endpoints.removed.length)
    console.log(`  - removed endpoints: ${endpoints.removed.map(shortEp).join(', ')}`);
  if (!endpoints.added.length && !endpoints.removed.length)
    console.log('  · no endpoints added or removed');

  if (findings.length) {
    console.log('\n  Behavior risks changed by this diff:');
    for (const f of findings)
      console.log(`  ${ICONS[f.severity]} [${f.severity}] ${f.rule} — ${f.message}`);
  }

  const c = v.counts;
  if (!v.provable)
    console.log(
      "\n✗ NO PROOF — 0 routes reached in the working tree; SPARDA could not see this change's route surface (a parser-coverage gap). An empty graph proves nothing — this is NOT a pass.",
    );
  else if (v.clean)
    console.log(
      '\n✓ PROVEN — this diff removes no protection and introduces no new risk.',
    );
  else
    console.log(
      `\n${v.safe ? '⚠ RISKY' : '✗ NOT PROVEN'} — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.info} info`,
    );
}

function renderMarkdown(r) {
  const { verdict: v, findings, endpoints } = r;
  const c = v.counts;
  const head = !v.provable
    ? "✗ **NO PROOF** — 0 routes reached in the working tree; SPARDA could not see this change's route surface (a parser-coverage gap). An empty graph proves nothing — this is NOT a pass."
    : v.clean
      ? '✓ **PROVEN** — no protection removed, no new risk introduced.'
      : `${v.safe ? '⚠ **RISKY**' : '✗ **NOT PROVEN**'} — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.info} info.`;
  const lines = [`## 🔍 SPARDA semantic review (vs \`${r.base}\`)`, '', head, ''];
  if (endpoints.added.length || endpoints.removed.length) {
    lines.push('### Endpoint surface');
    for (const e of endpoints.added) lines.push(`- 🆕 \`${shortEp(e)}\``);
    for (const e of endpoints.removed) lines.push(`- ❌ \`${shortEp(e)}\` (removed)`);
    lines.push('');
  }
  if (findings.length) {
    lines.push('### Protections removed / risks introduced');
    for (const f of findings)
      lines.push(`- ${ICONS[f.severity]} **[${f.severity}] ${f.rule}** — ${f.message}`);
    lines.push('');
  }
  lines.push(
    '<sub>Derived from the code + schema by SPARDA — a counterexample, not a heuristic.</sub>',
  );
  return lines.join('\n');
}

const shortEp = (id) => id.replace(/^entrypoint:/, '');

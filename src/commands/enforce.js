// commands/enforce.js — the third leg (ADR-076): SAST observes, RASP imposes, SPARDA does
// both AND proves what it imposed. `sparda enforce` closes the type-lock gap (ADR-070) by
// SYNTHESIS: a clean mutation route whose only protection is an ASSERTED guard (an opaque
// middleware SPARDA cannot read) gets a minimal boundary check SPARDA CAN read — inserted
// into the route's middleware chain, where domination is syntactically guaranteed (every
// chain step dominates the handler; no dominator-tree computation needed, the chain IS the
// dominance spine the guard scanner already trusts). PARTIAL → PROVEN, by construction.
//
// The three rails that keep this honest:
//   1. THE COURT — after writing, the app is recompiled and must prove PROVEN with zero new
//      findings; otherwise every edit is rolled back and the command fails. Enforcement that
//      cannot prove itself does not persist. (A non-denying check can never buy green: the
//      gate re-runs the same verifier that demanded the proof in the first place.)
//   2. REVERSIBILITY (hard rule #4) — the injected block is marker-fenced, the chain
//      insertion is a single unique identifier, and the pre-enforce content hash is recorded:
//      `sparda enforce --revert` restores the file byte-for-byte (verified by hash).
//   3. DISCLOSURE — the manifest (.sparda/enforce.json) makes an enforced proof auditable
//      and distinguishable from a native static proof; `prove` reads it and reports
//      PROVEN (ENFORCED), never a silent bare PROVEN. Soundness never depends on the
//      manifest: delete the injected check and the verdict falls back to PARTIAL on its own.
//
// V1 scope (honest): Express route registrations `<app|router>.<verb>('/path', mw…, handler)`
// with ≥1 middleware already in the chain (the asserted guard), JS/TS, same-file. The check
// denies when the authenticated principal is ABSENT (`req.user` by convention, configurable
// via --principal): legitimate traffic through a working auth middleware is untouched; a
// removed/broken auth middleware now fails closed instead of open.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import {
  checkGraph,
  verdictOf,
  verdictState,
  assertedOnlyMutationRoutes,
} from '../ubg/apocalypse.js';

export const ENFORCE_IDENT = 'spardaProvenAuth';
const MARK_START = '// >>> sparda-enforce (do not edit this block) >>>';
const MARK_END = '// <<< sparda-enforce <<<';
const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
const MANIFEST_REL = path.join('.sparda', 'enforce.json');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The synthesized boundary check. Deny-first, provable by the same scanner that verifies any
// guard (a 401 status response = deniesWithStatus): nothing about this is trusted by name.
// `body` is overridable ONLY so the adversarial tests can prove the court below rejects a
// non-denying counterfeit — production callers never pass it.
function shimBlock(principal, body) {
  return [
    '',
    MARK_START,
    '// SPARDA-synthesized boundary proof (ADR-076): denies when no authenticated principal is',
    "// present. Inserted because this file's guarded mutation route(s) rest on a guard SPARDA",
    '// could not verify. Behavior for authenticated traffic is unchanged. Revert with',
    '// `sparda enforce --revert`.',
    `const ${ENFORCE_IDENT} = (req, res, next) => {`,
    body ??
      `  if (!${principal}) return res.status(401).json({ error: 'unauthorized' });`,
    '  return next();',
    '};',
    MARK_END,
    '',
  ].join('\n');
}

// Find the route-registration CallExpression at (or spanning from) the entrypoint's recorded
// line: `<obj>.<verb>('/path', …)`. Returns the babel node or null.
function routeCallAt(ast, line) {
  let hit = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object' || hit) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (
      node.type === 'CallExpression' &&
      node.loc?.start.line === line &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.type === 'Identifier' &&
      HTTP_VERBS.has(node.callee.property.name) &&
      node.arguments?.length >= 2
    ) {
      hit = node;
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range') continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(ast.program);
  return hit;
}

// Compute the per-file edit plan for the given target routes. Pure: returns
// { insertions: [offset], needsBlock, blockOffset } or an error string.
function planFile(src, lines) {
  const ast = parse(src, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
  });
  const insertions = [];
  for (const line of lines) {
    const call = routeCallAt(ast, line);
    if (!call) return { error: `no route registration found at line ${line}` };
    const args = call.arguments;
    if (args.some((a) => a?.type === 'Identifier' && a.name === ENFORCE_IDENT)) continue; // idempotent
    if (args.length < 3)
      return {
        error: `route at line ${line} has no middleware chain to anchor to (path + handler only)`,
      };
    // insertion point: before the LAST argument (the handler) — after every existing
    // middleware, so the asserted guard still runs first and the proof shim dominates
    // only the handler, never the app's own middleware.
    insertions.push(args[args.length - 1].start);
  }
  const needsBlock = !src.includes(MARK_START);
  // the block goes after the last top-level import (or at the top for CJS)
  let blockOffset = 0;
  for (const stmt of ast.program.body)
    if (stmt.type === 'ImportDeclaration') blockOffset = stmt.end;
  return { insertions, needsBlock, blockOffset };
}

function applyEdits(src, plan, principal, shimBody) {
  const edits = plan.insertions
    .map((offset) => ({ offset, text: `${ENFORCE_IDENT}, ` }))
    .sort((a, b) => b.offset - a.offset);
  let out = src;
  for (const e of edits) out = out.slice(0, e.offset) + e.text + out.slice(e.offset);
  if (plan.needsBlock) {
    const at = plan.blockOffset;
    out = out.slice(0, at) + shimBlock(principal, shimBody) + out.slice(at);
  }
  return out;
}

function compileVerdict(cwd) {
  const canonical = canonicalizeGraph(compileUBG(cwd, { write: false }).graph);
  const { findings } = checkGraph(canonical);
  const verdict = verdictOf(findings, canonical, {});
  return { canonical, findings, verdict, state: verdictState(verdict) };
}

export function readEnforceManifest(cwd) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cwd, MANIFEST_REL), 'utf8'));
    // the manifest is a claim like any other — it counts only while the injected checks are
    // still in place (a hand-stripped shim must not read as ENFORCED)
    for (const [rel, rec] of Object.entries(m.files ?? {})) {
      const cur = fs.readFileSync(path.join(cwd, rel), 'utf8');
      if (sha(cur) !== rec.enforcedSha256 || !cur.includes(MARK_START)) return null;
    }
    return m;
  } catch {
    return null;
  }
}

export async function runEnforce(opts) {
  const cwd = opts.cwd;
  const principal = opts.principal ?? 'req.user';
  const log = (s) => console.error(s);

  if (opts.revert) return revertEnforce(cwd, { json: opts.json });

  // `req.user` / `req.auth` shapes only — the principal lands in a `!(...)` test inside the
  // generated code, so it must be a plain member path (defense against option injection).
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(principal))
    throw Object.assign(new Error(`invalid --principal: ${principal}`), {
      code: 'USER',
      hint: 'Use a plain member path like req.user or req.auth.',
    });

  const before = compileVerdict(cwd);
  const targets = assertedOnlyMutationRoutes(before.canonical).filter((t) => t.loc?.file);
  if (targets.length === 0) {
    const msg =
      before.state === 'PROVEN'
        ? 'Nothing to enforce — the app is already PROVEN.'
        : `Nothing to enforce — no clean mutation route rests on an asserted-only guard (verdict: ${before.state}). Enforce closes exactly that gap; other findings need real fixes, not synthesis.`;
    if (opts.json) console.log(JSON.stringify({ enforced: [], note: msg }, null, 2));
    else log(msg);
    return;
  }

  // group targets per file, plan all edits
  const byFile = new Map();
  for (const t of targets) {
    if (!byFile.has(t.loc.file)) byFile.set(t.loc.file, []);
    byFile.get(t.loc.file).push(t);
  }
  const plans = new Map(); // rel -> { src, out }
  for (const [rel, list] of byFile) {
    const abs = path.join(cwd, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const plan = planFile(
      src,
      list.map((t) => t.loc.line),
    );
    if (plan.error)
      throw Object.assign(new Error(`${rel}: ${plan.error}`), {
        code: 'USER',
        hint: 'This route shape is outside enforce V1 (Express chain form). File an issue with the route.',
      });
    plans.set(rel, { src, out: applyEdits(src, plan, principal, opts._shimBody) });
  }

  if (!opts.apply) {
    // dry-run is the default — enforcement writes code, so the plan is shown first
    log(`sparda enforce — plan (dry run; pass --apply to write):\n`);
    for (const t of targets)
      log(`  ⚙ ${t.label} — insert ${ENFORCE_IDENT} before the handler`);
    for (const rel of plans.keys())
      log(
        `  ⚙ ${rel} — add the marker-fenced ${ENFORCE_IDENT} block (denies without ${principal})`,
      );
    log(
      `\n  The check denies only when ${principal} is ABSENT. Verify your auth middleware sets it.\n  After --apply, SPARDA recompiles and keeps the edit ONLY if the app proves PROVEN.`,
    );
    if (opts.json)
      console.log(
        JSON.stringify(
          { plan: targets.map((t) => t.label), files: [...plans.keys()], applied: false },
          null,
          2,
        ),
      );
    return;
  }

  // write, then THE COURT: recompile — the edit persists only if it proves itself
  for (const [rel, p] of plans) fs.writeFileSync(path.join(cwd, rel), p.out);
  const after = compileVerdict(cwd);
  const stillAsserted = assertedOnlyMutationRoutes(after.canonical).length;
  const grewFindings = after.findings.length > before.findings.length;
  if (after.state !== 'PROVEN' || stillAsserted > 0 || grewFindings) {
    for (const [rel, p] of plans) fs.writeFileSync(path.join(cwd, rel), p.src); // roll back, byte-for-byte
    throw Object.assign(
      new Error(
        `enforcement did not prove itself (verdict ${after.state}, asserted-only left ${stillAsserted}${grewFindings ? ', new findings appeared' : ''}) — every edit rolled back`,
      ),
      {
        code: 'USER',
        hint: 'The synthesized check could not be verified on the recompiled graph. Nothing was changed.',
      },
    );
  }

  // record the manifest — the auditable provenance of the ENFORCED tier
  const manifest = {
    version: 1,
    at: new Date().toISOString(),
    principal,
    routes: targets.map((t) => t.label),
    files: Object.fromEntries(
      [...plans].map(([rel, p]) => [
        rel,
        { originalSha256: sha(p.src), enforcedSha256: sha(p.out) },
      ]),
    ),
  };
  fs.mkdirSync(path.join(cwd, '.sparda'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, MANIFEST_REL),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  if (opts.json)
    console.log(
      JSON.stringify(
        {
          enforced: manifest.routes,
          files: Object.keys(manifest.files),
          verdict: 'PROVEN (ENFORCED)',
        },
        null,
        2,
      ),
    );
  else {
    for (const t of targets) log(`  ✓ enforced ${t.label}`);
    log(
      `\n✓ PROVEN (ENFORCED) — ${targets.length} route(s) now carry a boundary check SPARDA verified on the recompiled graph.\n  Revert any time: sparda enforce --revert (byte-for-byte).`,
    );
  }
}

export function revertEnforce(cwd, { json } = {}) {
  const log = (s) => console.error(s);
  const manifestPath = path.join(cwd, MANIFEST_REL);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    log('Nothing to revert — no enforcement manifest found.');
    return;
  }
  const results = [];
  for (const [rel, rec] of Object.entries(manifest.files ?? {})) {
    const abs = path.join(cwd, rel);
    let cur;
    try {
      cur = fs.readFileSync(abs, 'utf8');
    } catch {
      results.push({ file: rel, restored: false, reason: 'missing' });
      continue;
    }
    // strip the fenced block (with the exact newlines shimBlock added around it), then the
    // chain identifiers — the two edits enforce made, undone in reverse
    let out = cur.replace(
      new RegExp(
        `\\n${MARK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`,
        'g',
      ),
      '',
    );
    out = out.split(`${ENFORCE_IDENT}, `).join('');
    fs.writeFileSync(abs, out);
    results.push({ file: rel, restored: sha(out) === rec.originalSha256 });
  }
  fs.rmSync(manifestPath, { force: true });
  const clean = results.every((r) => r.restored);
  if (json) console.log(JSON.stringify({ reverted: results, byteClean: clean }, null, 2));
  else {
    for (const r of results)
      log(
        r.restored
          ? `  ✓ ${r.file} restored byte-for-byte`
          : `  ⚠ ${r.file} reverted, but differs from the pre-enforce bytes (edited since?)`,
      );
    log(
      clean
        ? '✓ enforcement fully reverted.'
        : '⚠ reverted with differences — review the files above.',
    );
  }
}

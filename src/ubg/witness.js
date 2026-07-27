// ubg/witness.js — the GENERATOR side of generate-and-check (ADR-074), made safe by the
// deterministic verifier. Rice's theorem caps what SPARDA can PROVE by observation; the escape
// is the proof-carrying-code asymmetry (Necula–Lee): FINDING an ownership proof on arbitrary
// code is undecidable, CHECKING a proposed one is cheap. So an UNTRUSTED generator — the MCP
// client's own LLM via sampling, or the editing agent itself — proposes WHERE an O7/BOLA
// route's ownership check lives ({route, file, line}), and this module CHECKS the claim
// against the real AST. Recall comes from the generator; soundness NEVER does:
//
//   • a hint is never trusted — `verifyWitnessAt` re-derives the witness from the parsed
//     module at the hinted location with the same verifiers the static pass uses
//     (`ifAssertsOwnership` inline, `callBindsOwnershipWitness` through a helper call), so
//     a fabricated location, a spoof-compare, or a no-deny check is rejected exactly as it
//     would be in the static pass;
//   • the hint's file path is untrusted input — it is resolved and CONTAINED to the app dir
//     (a `../../` traversal reads as invalid, never opens a file outside the app);
//   • the whole loop feeds ONLY the O7 advisory (never a hard rule, never a guard, never
//     the verdict — O7 is advisory by design, ADR-058), so even a verifier bug could only
//     drop a non-gating advisory, never make a false PROVEN.
//
// Same contract as llm-resolve.js (verify-before-admit, E-022/E-025/E-026 discipline), on
// the BOLA half. The producer (MCP sampling) lives in server/stdio.js; this module stays
// pure and LLM-free so every admit path is deterministic and testable offline.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseModule,
  resolveExportedFunction,
  ifAssertsOwnership,
  callBindsOwnershipWitness,
} from './extract.js';
import { walkAst } from './resolve.js';

// The O7 advisories worth a generator pass — each carries the route label the generator
// must attribute its witness to. Deterministic order (the findings' own).
export function witnessTargets(findings) {
  return (findings ?? [])
    .filter((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN')
    .map((f) => ({
      entrypoint: f.entrypoint,
      route: String(f.entrypoint ?? '').replace(/^entrypoint:/, ''),
      message: f.message,
    }));
}

// Deterministically CHECK one proposed witness: does the node at `file:line` prove
// caller-ownership? Two recognized forms, the same two the static pass trusts:
//   inline-compare — an IfStatement STARTING at that line that denies behind a compare of a
//     fetched field against the caller's verified identity (`ifAssertsOwnership`);
//   helper-call — a call STARTING at that line to a same-module or imported helper, whose
//     call site binds the verified identity and whose resolved body denies on the compare
//     of exactly those bound params (`callBindsOwnershipWitness`).
// Returns { verified, via, reason } — never throws on hostile input.
export function verifyWitnessAt(appDir, file, line) {
  if (typeof file !== 'string' || !file || !Number.isInteger(line) || line < 1)
    return { verified: false, reason: 'invalid-hint' };
  // containment: the hint is untrusted input — it may never name a file outside the app.
  // Lexical check first (a `../` escape is rejected before any fs access), then realpath
  // on BOTH sides so a symlink inside the app pointing outside cannot smuggle a foreign
  // file in; any fs error fails closed.
  const lexRoot = path.resolve(appDir);
  let abs = path.resolve(lexRoot, file);
  if (abs !== lexRoot && !abs.startsWith(lexRoot + path.sep))
    return { verified: false, reason: 'outside-app-dir' };
  try {
    const root = fs.realpathSync(lexRoot);
    abs = fs.realpathSync(abs);
    if (abs !== root && !abs.startsWith(root + path.sep))
      return { verified: false, reason: 'outside-app-dir' };
    if (!fs.statSync(abs).isFile()) return { verified: false, reason: 'file-not-found' };
  } catch {
    return { verified: false, reason: 'file-not-found' };
  }
  const mod = parseModule(abs);
  if (mod.error) return { verified: false, reason: 'unparsable' };

  let result = null;
  walkAst(mod.ast.program, (node) => {
    if (result || node.loc?.start.line !== line) return;
    if (node.type === 'IfStatement' && ifAssertsOwnership(node)) {
      result = { verified: true, via: 'inline-compare' };
      return;
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
      const name = node.callee.name;
      let fn = mod.functions.get(name)?.node ?? null;
      if (!fn) {
        const imported = mod.imports.get(name);
        if (imported) {
          const target = parseModule(imported);
          if (!target.error) fn = resolveExportedFunction(target, name)?.fn?.node ?? null;
        }
      }
      if (fn && callBindsOwnershipWitness(node, fn))
        result = { verified: true, via: 'helper-call' };
    }
  });
  return result ?? { verified: false, reason: 'no-witness-at-location' };
}

// The attribution TETHER: a structurally-real witness elsewhere in the app must not clear a
// route that never reaches it (an adversarial generator could point every advisory at the one
// genuine check in the codebase). The hinted file must be the route's OWN file, or a module
// that file directly imports — the neighborhood the route's code can actually call into.
// One-hop by design (honest under-approximation: a deeper-but-real witness is rejected, an
// unreachable one never admitted).
function witnessFileTethered(appDir, epFile, hintFile) {
  if (!epFile) return false;
  const root = path.resolve(appDir);
  const hintAbs = path.resolve(root, hintFile);
  const epAbs = path.resolve(root, epFile);
  if (hintAbs === epAbs) return true;
  const mod = parseModule(epAbs);
  if (mod.error) return false;
  for (const file of mod.imports.values())
    if (path.resolve(file) === hintAbs) return true;
  return false;
}

// Check a batch of proposed witnesses against the app's O7 advisories. Each hint must name
// the route it claims to witness — an unattributed or unmatched hint buys nothing. Returns
// the full audit (every hint's outcome, so an LLM-guided discharge is always auditable and
// distinguishable from a native static clear) plus the surviving advisory count.
export function admitWitnesses(appDir, canonical, findings, hints) {
  const targets = witnessTargets(findings);
  const audits = [];
  const discharged = new Set();
  const epFileOf = (entrypoint) =>
    (canonical?.nodes ?? []).find((n) => n.id === entrypoint)?.loc?.file ?? null;
  for (const hint of (Array.isArray(hints) ? hints : []).slice(0, 50)) {
    const route = typeof hint?.route === 'string' ? hint.route : '';
    const target = route
      ? targets.find((t) => t.route.toLowerCase().includes(route.toLowerCase()))
      : null;
    if (!target) {
      audits.push({ route, verified: false, reason: 'no-matching-advisory' });
      continue;
    }
    if (
      typeof hint.file !== 'string' ||
      !hint.file ||
      !witnessFileTethered(appDir, epFileOf(target.entrypoint), hint.file)
    ) {
      audits.push({
        route: target.route,
        file: hint.file,
        line: hint.line,
        verified: false,
        reason: 'not-tethered-to-route',
      });
      continue;
    }
    const check = verifyWitnessAt(appDir, hint.file, hint.line);
    audits.push({
      route: target.route,
      file: hint.file,
      line: hint.line,
      verified: check.verified === true,
      ...(check.via ? { via: check.via } : {}),
      ...(check.reason ? { reason: check.reason } : {}),
      ...(check.verified === true ? { witnessVia: 'generator+verified' } : {}),
    });
    if (check.verified === true) discharged.add(target.route);
  }
  return {
    advisories: targets.length,
    audits,
    discharged: [...discharged].sort(),
    remaining: targets.filter((t) => !discharged.has(t.route)).map((t) => t.route),
  };
}

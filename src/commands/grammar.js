// commands/grammar.js — R3.3, the Rosetta stone: which call sequences MEAN
// something in this app. Derived, deterministic, never authoritative
// (ADR-021 §4): observed edges come from Labs circuits (real data flows seen
// N times); hypothesis edges come from twin exemplar response keys matching
// another tool's param names — always labelled, never acted on by themselves.
// The artifact lives in .sparda/grammar.json (regenerable, never committed).
import fs from 'node:fs';
import path from 'node:path';
import { walkPayload } from '../server/condenser.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';
import { twinFilePath } from './twin.js';

const MAX_HYPOTHESES = 50;
const GRAMMAR_VERSION = 'sparda-grammar/v1';

// bounded key harvest — same walk the condenser trusts, so what the grammar
// hypothesizes is exactly what a composite could later re-feed
export function responseKeysOf(exemplarData) {
  const keys = new Set();
  walkPayload(exemplarData, (k) => {
    keys.add(k);
    if (keys.size >= 40) return false;
  });
  return keys;
}

// pure: (manifest, exemplars|null) → the grammar
export function buildGrammar(manifest, exemplars = null) {
  const tools = manifest.tools ?? {};
  const edges = [];
  const seenEdge = new Set();
  const edgeKey = (e) => `${e.from}>${e.to}:${e.arg}`;

  // observed: the circuits ARE the sentences reality already spoke
  const phrases = [];
  for (const [key, cir] of Object.entries(manifest.labs?.circuits ?? {})) {
    phrases.push({
      key,
      steps: cir.steps ?? [],
      seen: cir.seen ?? 0,
      crystallized: Boolean(cir.composite),
      ...(cir.evolved ? { evolved: true } : {}),
    });
    for (const l of cir.links ?? []) {
      const e = {
        from: l.from,
        to: l.to,
        fromKey: l.fromKey,
        arg: l.arg,
        source: 'observed',
      };
      if (!seenEdge.has(edgeKey(e))) {
        seenEdge.add(edgeKey(e));
        edges.push(e);
      }
    }
  }

  // hypotheses: an exemplar of A answers with a key another tool B takes as a
  // param → maybe A feeds B. A guess, said out loud as a guess.
  if (exemplars) {
    for (const [from, ex] of Object.entries(exemplars)) {
      if (!tools[from] || ex?.data === undefined) continue;
      const keys = responseKeysOf(ex.data);
      for (const [to, t] of Object.entries(tools)) {
        if (to === from || !t.enabled || t.method !== 'GET') continue;
        for (const p of t.params ?? []) {
          if (edges.length >= MAX_HYPOTHESES + seenEdge.size) break;
          if (!keys.has(p.name)) continue;
          const e = { from, to, fromKey: p.name, arg: p.name, source: 'hypothesis' };
          if (seenEdge.has(edgeKey(e))) continue; // reality already confirmed it
          seenEdge.add(edgeKey(e));
          edges.push(e);
        }
      }
    }
  }

  return {
    version: GRAMMAR_VERSION,
    builtAt: new Date().toISOString(),
    nodes: Object.keys(tools),
    edges,
    phrases,
  };
}

export async function runGrammar(opts) {
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found.'), {
      code: 'USER',
      hint: 'run `npx sparda-mcp init` first',
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let exemplars = null;
  const twinPath = twinFilePath(opts.cwd);
  if (fs.existsSync(twinPath)) {
    try {
      exemplars = JSON.parse(fs.readFileSync(twinPath, 'utf8')).exemplars ?? null;
    } catch {
      exemplars = null;
    }
  }

  const grammar = buildGrammar(manifest, exemplars);
  const outPath = path.join(opts.cwd, '.sparda', 'grammar.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  atomicWrite(outPath, JSON.stringify(grammar, null, 2) + '\n');

  const observed = grammar.edges.filter((e) => e.source === 'observed');
  const hypotheses = grammar.edges.filter((e) => e.source === 'hypothesis');
  console.log(`✓ Grammar written: .sparda/grammar.json — ${grammar.nodes.length} tools`);
  if (grammar.phrases.length) {
    console.log(`  Sentences reality has spoken (${grammar.phrases.length}):`);
    for (const p of grammar.phrases.slice(0, 10))
      console.log(
        `    ${p.steps.join(' → ')} ×${p.seen}${p.crystallized ? ' (crystallized)' : ''}${p.evolved ? ' (evolved, unconfirmed)' : ''}`,
      );
  } else
    console.log(
      '  · no sentences observed yet — enable labs.recordSequences and use the app',
    );
  if (observed.length) console.log(`  Observed data flows: ${observed.length}`);
  if (hypotheses.length) {
    console.log(
      `  Hypotheses from twin exemplars (${hypotheses.length}) — guesses, said as guesses:`,
    );
    for (const e of hypotheses.slice(0, 10))
      console.log(`    ${e.from} —'${e.fromKey}'→ ${e.to}`);
  } else if (!exemplars)
    console.log(
      '  · no hypotheses — run `sparda twin --learn` first to give the grammar eyes',
    );
  return { grammar };
}

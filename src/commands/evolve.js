// commands/evolve.js — R3.4, Darwin/Baldwin: mutate candidate chains from the
// grammar's hypotheses, trial them against the TWIN (never the host — ADR-021
// §5), and let the survivors land as SUGGESTIONS: `labs.circuits` entries with
// `seen: 0` and `evolved: true`. They are not composites and never become one
// here — crystallization still demands the real observation threshold. An
// emergent capability is a suggestion until reality confirms it (survival §1).
import fs from 'node:fs';
import path from 'node:path';
import { buildGrammar } from './grammar.js';
import { createTwinServer, twinFilePath } from './twin.js';
import { findByKey } from '../server/crystallize.js';
import { mergeManifestKeySync } from '../server/persistence.js';
import { resolveSpardaKey } from '../generator/manifest.js';

const MAX_CANDIDATES_PER_RUN = 10;

// pure: hypothesis edges that no observed circuit already covers → candidates
export function candidateChains(grammar, circuits = {}) {
  const out = [];
  for (const e of grammar.edges ?? []) {
    if (e.source !== 'hypothesis') continue;
    const key = `${e.from}>${e.to}`;
    if (circuits[key]) continue; // reality (or a past run) got there first
    if (out.some((c) => c.key === key)) continue;
    out.push({
      key,
      steps: [e.from, e.to],
      links: [{ from: e.from, to: e.to, arg: e.arg, fromKey: e.fromKey }],
    });
    if (out.length >= MAX_CANDIDATES_PER_RUN) break;
  }
  return out;
}

// trial one candidate against a running twin: A answers, the linked key is
// really there, B accepts the fed value. All against the ghost, never the host.
export async function trialCandidate(candidate, { port, localKey }) {
  const invoke = async (tool, args) => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sparda-key': localKey },
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(5000),
    });
    return res.json();
  };
  const [a, b] = candidate.steps;
  const link = candidate.links[0];
  const first = await invoke(a, {});
  if (first?.upstreamStatus !== 200)
    return { ok: false, why: `${a} answered ${first?.upstreamStatus}` };
  const fed = findByKey(first.data, link.fromKey);
  if (fed === undefined)
    return { ok: false, why: `'${link.fromKey}' not found in ${a}'s exemplar` };
  if (typeof fed === 'object')
    return { ok: false, why: `'${link.fromKey}' is not a scalar` };
  const second = await invoke(b, { [link.arg]: fed });
  if (second?.upstreamStatus !== 200)
    return { ok: false, why: `${b} answered ${second?.upstreamStatus}` };
  return { ok: true, fedValueType: typeof fed };
}

export async function runEvolve(opts) {
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found.'), {
      code: 'USER',
      hint: 'run `npx sparda-mcp init` first',
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const twinPath = twinFilePath(opts.cwd);
  if (!fs.existsSync(twinPath)) {
    throw Object.assign(
      new Error(
        'no twin memory (.sparda/twin.json) — evolution needs the ghost to practice on.',
      ),
      {
        code: 'USER',
        hint: 'run `npx sparda-mcp twin --learn` against the live app first',
      },
    );
  }
  let exemplars = {};
  try {
    exemplars = JSON.parse(fs.readFileSync(twinPath, 'utf8')).exemplars ?? {};
  } catch {
    throw Object.assign(new Error('.sparda/twin.json is not valid JSON.'), {
      code: 'USER',
      hint: 're-run `npx sparda-mcp twin --learn`',
    });
  }

  const grammar = buildGrammar(manifest, exemplars);
  const candidates = candidateChains(grammar, manifest.labs?.circuits ?? {});
  if (!candidates.length) {
    console.log(
      '· Nothing to evolve — no untested hypothesis chains (grammar has no new guesses).',
    );
    return { survivors: [], failed: [] };
  }

  // the practice arena: an in-process twin on an ephemeral port
  const localKey = resolveSpardaKey(opts.cwd, manifest);
  const server = createTwinServer(manifest, localKey, exemplars);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const survivors = [];
  const failed = [];
  try {
    for (const c of candidates) {
      const verdict = await trialCandidate(c, { port, localKey });
      if (verdict.ok) survivors.push(c);
      else failed.push({ key: c.key, why: verdict.why });
    }
  } finally {
    server.close();
  }

  if (survivors.length) {
    manifest.labs ??= {};
    manifest.labs.circuits ??= {};
    const now = new Date().toISOString();
    for (const c of survivors) {
      manifest.labs.circuits[c.key] = {
        steps: c.steps,
        links: c.links,
        seen: 0, // heredity without confirmation: reality still has to speak
        evolved: true,
        firstSeen: now,
        lastSeen: now,
      };
    }
    mergeManifestKeySync(manifestPath, 'labs', manifest.labs);
  }

  console.log(
    `✓ Evolution run: ${candidates.length} candidate(s) trialed against the twin — ${survivors.length} survivor(s), ${failed.length} culled`,
  );
  for (const c of survivors)
    console.log(
      `  + suggested circuit: ${c.steps.join(' → ')} (seen: 0 — crystallizes only after real observations)`,
    );
  for (const f of failed) console.log(`  - culled ${f.key}: ${f.why}`);
  console.log('  The host was never touched: every trial ran against the ghost.');
  return { survivors, failed };
}

// commands/seed.js — the genome (R4.5 lite): everything the organism LEARNED,
// distilled into a file that can regerminate elsewhere (dev → prod, or a
// community seed for a popular stack) without re-paying the learning.
//
// The closed circle: app → usage → seed → next app. Structure and lessons
// only — never a value, never a secret, never a security decision:
//   EXPORTED : semantic descriptions/workflows, immune antibodies, failure
//              lessons, Labs circuit structure.
//   NEVER    : localKey, port, policies, per-tool `enabled`, events, paths.
// An imported seed is UNTRUSTED input: every text field is re-sanitized, the
// security fields are stripped even if present, and nothing it contains can
// enable a write or change a policy (hard rule #3 is not negotiable by file).
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeDescription } from '../security/sanitize.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const SEED_VERSION = 'sparda-seed/v1';
const MAX_ANTIBODIES = 50; // same cap as the bridge
const MAX_WORKFLOWS = 20;
const MAX_CIRCUITS = 30; // same cap as the condenser
const MAX_FAILURES = 50;

const clean = (raw, fallback = '') => sanitizeDescription(raw, fallback).text;

// ── pure: manifest → seed ──────────────────────────────────────────────────

export function buildSeed(manifest) {
  const seed = {
    version: SEED_VERSION,
    framework: manifest.framework ?? 'unknown',
    exportedAt: new Date().toISOString(),
    semantic: { descriptions: {}, workflows: [] },
    antibodies: {},
    failures: {},
    circuits: {},
  };

  for (const [tool, desc] of Object.entries(manifest.semantic?.descriptions ?? {})) {
    seed.semantic.descriptions[tool] = clean(desc);
  }
  for (const wf of (manifest.semantic?.workflows ?? []).slice(0, MAX_WORKFLOWS)) {
    seed.semantic.workflows.push({
      name: clean(wf.name, 'workflow'),
      description: clean(wf.description),
      steps: Array.isArray(wf.steps) ? wf.steps.map((s) => clean(s)).slice(0, 20) : [],
    });
  }
  for (const [sig, a] of Object.entries(manifest.immune?.antibodies ?? {}).slice(
    0,
    MAX_ANTIBODIES,
  )) {
    seed.antibodies[sig] = { diagnosis: clean(a.diagnosis), hits: Number(a.hits) || 0 };
  }
  for (const [sig, f] of Object.entries(manifest.sparding?.failures ?? {}).slice(
    0,
    MAX_FAILURES,
  )) {
    seed.failures[sig] = { count: Number(f.count) || 0, lesson: clean(f.lesson) };
  }
  for (const [key, cir] of Object.entries(manifest.labs?.circuits ?? {}).slice(
    0,
    MAX_CIRCUITS,
  )) {
    // structure only, exactly what the condenser persists — never values
    seed.circuits[key] = {
      steps: Array.isArray(cir.steps) ? cir.steps : [],
      links: Array.isArray(cir.links) ? cir.links : [],
      seen: Number(cir.seen) || 0,
      ...(cir.composite
        ? {
            composite: {
              name: clean(cir.composite.name, 'composite'),
              description: clean(cir.composite.description),
              source: 'seed',
            },
          }
        : {}),
    };
  }
  return seed;
}

// ── pure: (manifest, seed) → merged manifest — local knowledge wins ────────

export function mergeSeed(manifest, seed) {
  if (!seed || seed.version !== SEED_VERSION) {
    throw Object.assign(new Error('not a SPARDA seed (missing/unknown version field).'), {
      code: 'USER',
      hint: `expected "version": "${SEED_VERSION}" — re-export with npx sparda-mcp seed export`,
    });
  }
  const m = structuredClone(manifest);
  const toolNames = new Set(Object.keys(m.tools ?? {}));
  const sigToolExists = (sig) => {
    // signatures are `source|tool|status` — a lesson about a tool this app
    // does not have is noise, not knowledge
    const tool = String(sig).split('|')[1];
    return tool === 'null' || tool === 'undefined' || toolNames.has(tool);
  };
  const report = {
    descriptions: 0,
    workflows: 0,
    antibodies: 0,
    failures: 0,
    circuits: 0,
    skipped: 0,
  };

  m.semantic ??= { descriptions: {}, workflows: [] };
  m.semantic.descriptions ??= {};
  m.semantic.workflows ??= [];
  for (const [tool, desc] of Object.entries(seed.semantic?.descriptions ?? {})) {
    if (!toolNames.has(tool)) {
      report.skipped++;
      continue;
    }
    if (m.semantic.descriptions[tool]) continue; // local knowledge wins
    m.semantic.descriptions[tool] = clean(desc);
    report.descriptions++;
  }
  const wfNames = new Set(m.semantic.workflows.map((w) => w.name));
  for (const wf of (seed.semantic?.workflows ?? []).slice(0, MAX_WORKFLOWS)) {
    const name = clean(wf.name, 'workflow');
    if (wfNames.has(name) || m.semantic.workflows.length >= MAX_WORKFLOWS) continue;
    wfNames.add(name);
    m.semantic.workflows.push({
      name,
      description: clean(wf.description),
      steps: Array.isArray(wf.steps) ? wf.steps.map((s) => clean(s)).slice(0, 20) : [],
      source: 'seed',
    });
    report.workflows++;
  }

  m.immune ??= { antibodies: {} };
  m.immune.antibodies ??= {};
  for (const [sig, a] of Object.entries(seed.antibodies ?? {})) {
    if (!sigToolExists(sig)) {
      report.skipped++;
      continue;
    }
    if (
      Object.keys(m.immune.antibodies).length >= MAX_ANTIBODIES &&
      !m.immune.antibodies[sig]
    )
      continue;
    const existing = m.immune.antibodies[sig];
    if (existing) {
      existing.hits = Math.max(Number(existing.hits) || 0, Number(a.hits) || 0);
    } else {
      m.immune.antibodies[sig] = {
        diagnosis: clean(a.diagnosis),
        hits: Number(a.hits) || 0,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        source: 'seed',
      };
      report.antibodies++;
    }
  }

  m.sparding ??= {};
  m.sparding.failures ??= {};
  for (const [sig, f] of Object.entries(seed.failures ?? {})) {
    if (!sigToolExists(sig)) {
      report.skipped++;
      continue;
    }
    const existing = m.sparding.failures[sig];
    if (existing) {
      existing.count = Math.max(Number(existing.count) || 0, Number(f.count) || 0);
    } else if (Object.keys(m.sparding.failures).length < MAX_FAILURES) {
      m.sparding.failures[sig] = { count: Number(f.count) || 0, lesson: clean(f.lesson) };
      report.failures++;
    }
  }

  m.labs ??= {};
  m.labs.circuits ??= {};
  for (const [key, cir] of Object.entries(seed.circuits ?? {})) {
    if (m.labs.circuits[key]) continue; // local observation wins
    const stepTools = (Array.isArray(cir.steps) ? cir.steps : [])
      .map((s) => (typeof s === 'string' ? s : s?.tool))
      .filter(Boolean);
    if (!stepTools.every((t) => toolNames.has(t))) {
      report.skipped++;
      continue;
    }
    if (Object.keys(m.labs.circuits).length >= MAX_CIRCUITS) continue;
    m.labs.circuits[key] = {
      steps: cir.steps,
      links: Array.isArray(cir.links) ? cir.links : [],
      seen: Number(cir.seen) || 0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      ...(cir.composite
        ? {
            composite: {
              name: clean(cir.composite.name, 'composite'),
              description: clean(cir.composite.description),
              source: 'seed',
              createdAt: new Date().toISOString(),
            },
          }
        : {}),
    };
    report.circuits++;
  }

  // the file may claim anything — the organism's security is not up for
  // negotiation: whatever a seed carries, these never cross (hard rule #3/#5)
  // (localKey, port, policies and per-tool `enabled` were simply never read.)
  return { manifest: m, report };
}

// ── the command: seed export [--out f] | seed import <file> ───────────────

export async function runSeed(opts, args) {
  const sub = args[0];
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found.'), {
      code: 'USER',
      hint: 'run `npx sparda-mcp init` first',
    });
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw Object.assign(new Error('sparda.json is not valid JSON.'), {
      code: 'USER',
      hint: 'restore it from git or re-run `npx sparda-mcp init`',
    });
  }

  if (sub === 'export') {
    const seed = buildSeed(manifest);
    const out = opts.out ?? 'sparda-seed.json';
    atomicWrite(path.resolve(opts.cwd, out), JSON.stringify(seed, null, 2) + '\n');
    console.log(
      `✓ Seed exported: ${out} — ${Object.keys(seed.antibodies).length} antibodies, ${Object.keys(seed.semantic.descriptions).length} descriptions, ${seed.semantic.workflows.length} workflows, ${Object.keys(seed.circuits).length} circuits, ${Object.keys(seed.failures).length} lessons`,
    );
    console.log('  Structure and lessons only. No key, no policy, no value ever leaves.');
    return { seed };
  }

  if (sub === 'import') {
    const file = args[1];
    if (!file) {
      throw Object.assign(new Error('missing seed file.'), {
        code: 'USER',
        hint: 'usage: npx sparda-mcp seed import <sparda-seed.json>',
      });
    }
    const abs = path.resolve(opts.cwd, file);
    if (!fs.existsSync(abs)) {
      throw Object.assign(new Error(`seed file not found: ${file}`), { code: 'USER' });
    }
    let seed;
    try {
      seed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      throw Object.assign(new Error('seed file is not valid JSON.'), { code: 'USER' });
    }
    const { manifest: merged, report } = mergeSeed(manifest, seed);
    atomicWrite(manifestPath, JSON.stringify(merged, null, 2) + '\n');
    console.log(
      `✓ Seed germinated into sparda.json — +${report.antibodies} antibodies, +${report.descriptions} descriptions, +${report.workflows} workflows, +${report.circuits} circuits, +${report.failures} lessons (${report.skipped} entries skipped: unknown tools here)`,
    );
    console.log(
      '  Local knowledge always wins; keys, policies and enabled flags were never read.',
    );
    // R4.5 full — germination: the derived organs regrow from the imported
    // structure on THIS machine (values never travelled; they never do).
    if (opts.germinate) {
      const { buildGrammar } = await import('./grammar.js');
      const { twinFilePath } = await import('./twin.js');
      let exemplars = null;
      try {
        exemplars =
          JSON.parse(fs.readFileSync(twinFilePath(opts.cwd), 'utf8')).exemplars ?? null;
      } catch {
        exemplars = null; // no local twin memory yet — grammar grows from structure alone
      }
      const grammar = buildGrammar(merged, exemplars);
      const outPath = path.join(opts.cwd, '.sparda', 'grammar.json');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      atomicWrite(outPath, JSON.stringify(grammar, null, 2) + '\n');
      console.log(
        `✓ Germinated: grammar regrown from the imported genome (${grammar.phrases.length} phrases, ${grammar.edges.length} edges) → .sparda/grammar.json`,
      );
    }
    return { report };
  }

  throw Object.assign(new Error(`unknown seed subcommand: ${sub ?? '(none)'}`), {
    code: 'USER',
    hint: 'usage: npx sparda-mcp seed export [--out file] | seed import <file>',
  });
}

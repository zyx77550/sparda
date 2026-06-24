// generator/manifest.js — carry user state across re-runs of `sparda init`
import fs from 'node:fs';
import path from 'node:path';

// Re-running init must not wipe what the user (or the semantic/immune/Labs
// passes) wrote into sparda.json: per-tool `enabled` overrides, the cached
// `semantic` enrichment, the `immune` memory (antibodies), the `labs`
// state (opt-in flags + observed circuits), and the `sparding` security
// memory survive as long as the tool's method+path are unchanged.
export function carryOverManifest(cwd, tools) {
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(path.join(cwd, 'sparda.json'), 'utf8'));
  } catch {
    return null;
  }
  for (const [name, t] of Object.entries(tools)) {
    const old = prev?.tools?.[name];
    if (
      old &&
      typeof old.enabled === 'boolean' &&
      old.method === t.method &&
      old.path === t.path
    ) {
      t.enabled = old.enabled;
    }
  }
  return prev;
}

export function defaultSpardingMemory(prev) {
  return (
    prev?.sparding ?? {
      version: 1,
      policies: {
        reads: 'allow',
        writes: 'require_human',
        deletes: 'block',
        requireProofAfterWrite: true,
      },
      events: [],
      failures: {},
      toolFingerprints: {},
    }
  );
}

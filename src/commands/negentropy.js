// commands/negentropy.js — the Maxwell's demon pass (`doctor --app`, R3.1).
// Detects rot, deterministically and with zero LLM: schema drift (the code
// moved, the manifest didn't), stale/unsynced tools, dead current, chronic
// antigens the immune system keeps diagnosing but nobody fixes, and zombie
// config. Every finding names its repair. Honest by construction: a gauge
// that cannot be measured says so instead of guessing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveSpardaKey } from '../generator/manifest.js';

// same fingerprint the generators stamp into sparding.toolFingerprints —
// method|path|params, sha256/8. Divergence = the route's shape changed.
export function fingerprintFor(tool) {
  const raw = `${tool.method}|${tool.path}|${JSON.stringify(tool.params ?? [])}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
}

// routes (parser output) → the tool shape the generators build, keyed the
// same way, so fingerprints are comparable across init/sync/doctor.
export function toolShapeOf(route) {
  return {
    method: route.method.toUpperCase(),
    path: route.path,
    params: route.params ?? [],
  };
}

// Pure core. inputs:
//   manifest       — parsed sparda.json (required)
//   currentRoutes  — parser output for the code as it is NOW, or null (parse failed)
//   live           — /mcp/stats payload, or null (host down)
//   detectedPort   — what detect.js sees now, or null
//   cwd            — for file existence checks (router present?)
export function buildNegentropy({ manifest, currentRoutes, live, detectedPort, cwd }) {
  const findings = [];
  const add = (kind, severity, title, detail, fix) =>
    findings.push({ kind, severity, title, detail, fix });

  const tools = manifest.tools ?? {};
  const byKey = new Map(
    Object.entries(tools).map(([name, t]) => [`${t.method} ${t.path}`, name]),
  );

  // ── drift: manifest vs the code as parsed right now ──────────────────────
  if (currentRoutes) {
    const currentKeys = new Map(
      currentRoutes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r]),
    );
    for (const [key, name] of byKey) {
      if (!currentKeys.has(key)) {
        add(
          'drift',
          'high',
          `stale tool: ${name}`,
          `${key} is in sparda.json but no longer exists in the code — the AI sees a ghost route`,
          'npx sparda-mcp sync',
        );
      }
    }
    for (const [key] of currentKeys) {
      if (!byKey.has(key)) {
        add(
          'drift',
          'medium',
          `unsynced route: ${key}`,
          'exists in the code but not in sparda.json — invisible to the AI',
          'npx sparda-mcp sync',
        );
      }
    }
    const storedFps = manifest.sparding?.toolFingerprints ?? {};
    for (const [key, name] of byKey) {
      const route = currentKeys.get(key);
      if (!route || !storedFps[name]) continue;
      const fp = fingerprintFor(toolShapeOf(route));
      if (fp !== storedFps[name]) {
        add(
          'drift',
          'medium',
          `shape drift: ${name}`,
          `route structure changed since the last sync (fingerprint ${storedFps[name]} → ${fp}) — params the AI knows may be wrong`,
          'npx sparda-mcp sync',
        );
      }
    }
  } else {
    add(
      'drift',
      'info',
      'drift not measurable',
      'the current code could not be re-parsed — drift against the manifest is unknown',
      'fix the parse error reported above, then re-run',
    );
  }

  // ── dead current: enabled tools nobody exercised this session ────────────
  if (live) {
    const stats = live.stats ?? {};
    const totalCalls = Object.values(stats).reduce((n, s) => n + (s.calls ?? 0), 0);
    const uptime = live.uptimeSec ?? 0;
    if (totalCalls > 0 && uptime >= 60) {
      for (const [name, t] of Object.entries(tools)) {
        if (!t.enabled) continue;
        if ((stats[name]?.calls ?? 0) === 0) {
          add(
            'dead',
            'info',
            `no current: ${name}`,
            `${t.method} ${t.path} — zero calls since host start (${uptime}s, ${totalCalls} calls elsewhere). RAM gauge: this session only, not a lifetime verdict`,
            'if this route is dead in the code too, delete it; if it matters, tell the AI about it (semantic pass)',
          );
        }
      }
    } else {
      add(
        'dead',
        'info',
        'current not measurable yet',
        `host up ${uptime}s with ${totalCalls} total calls — not enough observation to call any route dead`,
        'let the app run under real usage, then re-run',
      );
    }
    for (const [name, q] of Object.entries(live.quarantine ?? {})) {
      add(
        'sick',
        'high',
        `quarantined: ${name}`,
        `the immune system is protecting this route (${q.reason ?? 'repeated 5xx'})`,
        'fix the underlying failure; quarantine lifts itself (half-open probe)',
      );
    }
  } else {
    add(
      'dead',
      'info',
      'live gauges unavailable',
      'host not running — dead-current and quarantine checks need the app up',
      'start the app, then re-run npx sparda-mcp doctor --app',
    );
  }

  // ── chronic antigens: diagnosed again and again, never fixed ─────────────
  const failures = Object.entries(manifest.sparding?.failures ?? {})
    .map(([sig, f]) => ({ sig, count: f.count ?? 0, lesson: f.lesson ?? '' }))
    .filter((f) => f.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  for (const f of failures) {
    add(
      'sick',
      'medium',
      `recurring failure: ${f.sig}`,
      `${f.count} occurrences${f.lesson ? ` — lesson on file: ${f.lesson}` : ''}`,
      f.sig.includes('write_disabled')
        ? 'the AI keeps hitting a write-safety wall: enable the tool deliberately, or leave it and the block keeps doing its job'
        : 'the diagnosis exists in the journal; the fix does not — repair the route',
    );
  }
  const antibodies = Object.entries(manifest.immune?.antibodies ?? {})
    .map(([sig, a]) => ({ sig, hits: a.hits ?? 0, diagnosis: a.diagnosis ?? '' }))
    .filter((a) => a.hits >= 3)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3);
  for (const a of antibodies) {
    add(
      'sick',
      'medium',
      `chronic antigen: ${a.sig}`,
      `${a.hits} zero-token diagnoses served — the memory works, the wound stays open${a.diagnosis ? ` (${a.diagnosis.slice(0, 100)})` : ''}`,
      'apply the cached diagnosis for real; the antibody then goes quiet on its own',
    );
  }

  // ── zombie config ─────────────────────────────────────────────────────────
  if (detectedPort && manifest.port && detectedPort !== manifest.port) {
    add(
      'zombie',
      'high',
      'port drift',
      `sparda.json says :${manifest.port} but the app now runs on :${detectedPort} — the bridge and the proxy point at the wrong door`,
      'npx sparda-mcp sync (re-detects and regenerates)',
    );
  }
  for (const f of manifest.generatedFiles ?? []) {
    const abs = path.resolve(cwd ?? '.', f);
    if (!fs.existsSync(abs)) {
      add(
        'zombie',
        'high',
        'router file missing',
        `${f} is recorded in sparda.json but absent on disk — the organism has a memory of a body it no longer has`,
        'npx sparda-mcp init --yes (regenerates; carry-over keeps your state)',
      );
    } else {
      const key = resolveSpardaKey(cwd, manifest);
      if (key && !fs.readFileSync(abs, 'utf8').includes(key)) {
        add(
          'zombie',
          'high',
          'router/manifest key mismatch',
          `${f} does not carry the manifest's localKey — a stale router from an older init is still wired in`,
          'npx sparda-mcp init --yes',
        );
      }
    }
  }

  const summary = { drift: 0, dead: 0, sick: 0, zombie: 0 };
  for (const f of findings) summary[f.kind] += 1;
  const actionable = findings.filter((f) => f.severity !== 'info');
  return { findings, summary, actionable: actionable.length };
}

// terminal rendering, doctor-style: ✗ fails CI, ⚠ warns, · informs
export function renderNegentropy(result) {
  const lines = [];
  let failing = false;
  lines.push('  Negentropy scan (doctor --app)');
  if (result.findings.length === 0) {
    lines.push('  ✓ no rot detected — manifest, code and gauges agree');
    return { lines, failing };
  }
  for (const f of result.findings) {
    const glyph = f.severity === 'high' ? '✗' : f.severity === 'medium' ? '⚠' : '·';
    if (f.severity === 'high') failing = true;
    lines.push(`  ${glyph} [${f.kind}] ${f.title}`);
    lines.push(`      ${f.detail}`);
    lines.push(`      → ${f.fix}`);
  }
  lines.push(
    `  ${result.actionable ? '⚠' : '·'} ${result.findings.length} finding(s) — drift ${result.summary.drift} · dead ${result.summary.dead} · sick ${result.summary.sick} · zombie ${result.summary.zombie}`,
  );
  return { lines, failing };
}

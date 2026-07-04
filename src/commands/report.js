// commands/report.js — the readable black box.
// Renders everything the organism already remembers (sparda.json) plus, when
// the host is up, the live gauges (/mcp/stats) — as a terminal report, a
// self-contained HTML file, or raw JSON. Deterministic, zero new deps, and
// read-only: it never mutates the manifest and never touches the host routes.
import fs from 'node:fs';
import path from 'node:path';
import { c, gradient } from '../ui/style.js';
import { resolveSpardaKey } from '../generator/manifest.js';

// ── pure: manifest (+ optional live stats) → report data ──────────────────

export function buildReport(manifest, live = null) {
  const tools = Object.entries(manifest.tools ?? {}).map(([name, t]) => ({
    name,
    method: (t.method ?? 'GET').toUpperCase(),
    path: t.path ?? '',
    enabled: Boolean(t.enabled),
  }));
  const writes = tools.filter((t) => t.method !== 'GET');

  const events = manifest.sparding?.events ?? [];
  const byDecision = {};
  for (const e of events) byDecision[e.decision] = (byDecision[e.decision] ?? 0) + 1;

  const failures = Object.entries(manifest.sparding?.failures ?? {})
    .map(([sig, f]) => ({ sig, count: f.count ?? 0, lesson: f.lesson ?? '' }))
    .sort((a, b) => b.count - a.count);

  const antibodies = Object.entries(manifest.immune?.antibodies ?? {})
    .map(([sig, a]) => ({
      sig,
      diagnosis: a.diagnosis ?? '',
      hits: a.hits ?? 0,
      lastSeen: a.lastSeen ?? null,
    }))
    .sort((a, b) => b.hits - a.hits);
  const antibodyHits = antibodies.reduce((n, a) => n + a.hits, 0);

  const circuits = Object.entries(manifest.labs?.circuits ?? {}).map(([key, cir]) => ({
    key,
    seen: cir.seen ?? 0,
    composite: cir.composite
      ? { name: cir.composite.name, description: cir.composite.description ?? '' }
      : null,
  }));
  const composites = circuits.filter((x) => x.composite);

  let liveSection = null;
  if (live) {
    const perTool = Object.entries(live.stats ?? {}).map(([name, s]) => ({
      name,
      calls: s.calls ?? 0,
      errors: s.errors ?? 0,
      avgMs: s.calls ? Math.round((s.totalMs ?? 0) / s.calls) : 0,
    }));
    const totals = perTool.reduce(
      (a, t) => ({ calls: a.calls + t.calls, errors: a.errors + t.errors }),
      { calls: 0, errors: 0 },
    );
    const purityCount = {};
    for (const p of Object.values(live.purity ?? {}))
      purityCount[p.class ?? 'unknown'] = (purityCount[p.class ?? 'unknown'] ?? 0) + 1;
    liveSection = {
      uptimeSec: live.uptimeSec ?? 0,
      totals,
      topTools: perTool.sort((a, b) => b.calls - a.calls).slice(0, 5),
      quarantine: Object.entries(live.quarantine ?? {}).map(([tool, q]) => ({
        tool,
        reason: q.reason ?? '',
      })),
      recycle: live.recycle ?? null,
      purityCount,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    meta: {
      framework: manifest.framework ?? 'unknown',
      entryFile: manifest.entryFile ?? '',
      port: manifest.port ?? null,
      createdAt: manifest.createdAt ?? null,
    },
    tools: {
      total: tools.length,
      enabled: tools.filter((t) => t.enabled).length,
      writes: writes.length,
      writesEnabled: writes.filter((t) => t.enabled).length,
    },
    semantic: {
      descriptions: Object.keys(manifest.semantic?.descriptions ?? {}).length,
      workflows: (manifest.semantic?.workflows ?? []).length,
    },
    proof: {
      events: events.length,
      byDecision,
      lastEventAt: events.length ? events[events.length - 1].ts : null,
      failures: failures.slice(0, 3),
      failureCount: failures.length,
    },
    immunity: {
      antibodies: antibodies.length,
      hits: antibodyHits,
      top: antibodies.slice(0, 3),
    },
    organs: {
      circuits: circuits.length,
      composites: composites.map((x) => x.composite),
    },
    live: liveSection,
  };
}

// ── pure: report → terminal string (colors auto-disable off-TTY) ──────────

export function renderTerminal(r) {
  const L = [];
  const empty = (msg) => c.dim(`  · ${msg}`);
  L.push('');
  L.push(`  ${gradient('SPARDA')} ${c.dim('— black box report')}`);
  L.push(
    c.dim(
      `  ${r.meta.framework} · ${r.meta.entryFile}${r.meta.port ? ` · :${r.meta.port}` : ''} · ${r.generatedAt}`,
    ),
  );
  L.push('');

  L.push(c.bold('  Tools'));
  L.push(
    `  ✓ ${r.tools.enabled}/${r.tools.total} exposed to AI — ${r.tools.writesEnabled}/${r.tools.writes} write tools opted in (writes are off by default)`,
  );
  if (r.semantic.descriptions || r.semantic.workflows)
    L.push(
      `  ✓ semantic memory: ${r.semantic.descriptions} enriched descriptions, ${r.semantic.workflows} workflows`,
    );
  L.push('');

  L.push(c.bold('  Proof journal') + c.dim(' (last 100 agent actions)'));
  if (r.proof.events) {
    const parts = Object.entries(r.proof.byDecision)
      .map(([d, n]) => `${n} ${d}`)
      .join(', ');
    L.push(`  ✓ ${r.proof.events} proofed invocations — ${parts}`);
    if (r.proof.failureCount) {
      L.push(
        `  ⚠ ${r.proof.failureCount} failure signature${r.proof.failureCount > 1 ? 's' : ''} with lessons:`,
      );
      for (const f of r.proof.failures)
        L.push(c.dim(`     ${f.sig} ×${f.count}${f.lesson ? ` — ${f.lesson}` : ''}`));
    }
  } else
    L.push(
      empty('no agent activity recorded yet — the journal fills as AI drives the app'),
    );
  L.push('');

  L.push(c.bold('  Immune memory'));
  if (r.immunity.antibodies) {
    L.push(
      `  ✓ ${r.immunity.antibodies} antibod${r.immunity.antibodies > 1 ? 'ies' : 'y'} — ${r.immunity.hits} diagnoses served from memory (zero tokens)`,
    );
    for (const a of r.immunity.top)
      L.push(
        c.dim(
          `     ${a.sig} ×${a.hits}${a.diagnosis ? ` — ${a.diagnosis.slice(0, 80)}` : ''}`,
        ),
      );
  } else L.push(empty('no antibodies yet — they grow when failures get diagnosed'));
  L.push('');

  L.push(c.bold('  Emergent organs') + c.dim(' (Labs)'));
  if (r.organs.circuits) {
    L.push(
      `  ✓ ${r.organs.circuits} circuit${r.organs.circuits > 1 ? 's' : ''} observed`,
    );
    for (const comp of r.organs.composites)
      L.push(
        `  ✓ composite tool born: ${c.cyan(comp.name)}${comp.description ? c.dim(` — ${comp.description.slice(0, 70)}`) : ''}`,
      );
  } else
    L.push(
      empty(
        'no circuits observed — enable labs.recordSequences to condense usage into tools',
      ),
    );
  L.push('');

  L.push(c.bold('  Live gauges'));
  if (r.live) {
    L.push(
      `  ✓ host up ${r.live.uptimeSec}s — ${r.live.totals.calls} calls, ${r.live.totals.errors} errors`,
    );
    for (const t of r.live.topTools)
      L.push(
        c.dim(`     ${t.name}: ${t.calls} calls · ${t.errors} errors · ~${t.avgMs}ms`),
      );
    if (r.live.recycle)
      L.push(
        `  ✓ recycling: ${r.live.recycle.ratePct ?? 0}% served by the circle (${r.live.recycle.servedByCircle ?? 0} recycled vs ${r.live.recycle.paidFull ?? 0} full-price)`,
      );
    const pc = Object.entries(r.live.purityCount ?? {});
    if (pc.length)
      L.push(c.dim(`     route purity: ${pc.map(([k, n]) => `${n} ${k}`).join(', ')}`));
    if (r.live.quarantine.length)
      for (const q of r.live.quarantine)
        L.push(`  ⚠ quarantined: ${q.tool} (${q.reason})`);
    else L.push('  ✓ quarantine empty — no route is currently sick');
  } else
    L.push(
      empty(
        'host not running — showing persisted memory only (start the app for live gauges)',
      ),
    );
  L.push('');
  return L.join('\n');
}

// ── pure: report → self-contained HTML (no external assets, no scripts) ───

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderHtml(r) {
  const stat = (n, label) =>
    `<div class="stat"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
  const rows = (items, cols) =>
    items
      .map((it) => `<tr>${cols.map((k) => `<td>${esc(it[k] ?? '')}</td>`).join('')}</tr>`)
      .join('');

  const liveBlock = r.live
    ? `<h2>Live gauges</h2>
<div class="grid">
${stat(r.live.totals.calls, 'calls')}${stat(r.live.totals.errors, 'errors')}${stat(
        r.live.recycle ? `${r.live.recycle.ratePct ?? 0}%` : '—',
        'compute recycled',
      )}${stat(r.live.quarantine.length, 'quarantined')}
</div>
<table><thead><tr><th>tool</th><th>calls</th><th>errors</th><th>avg ms</th></tr></thead>
<tbody>${rows(r.live.topTools, ['name', 'calls', 'errors', 'avgMs'])}</tbody></table>`
    : `<h2>Live gauges</h2><p class="dim">Host not running — persisted memory only.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPARDA report — ${esc(r.meta.entryFile)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:48px 24px;background:#0b0b10;color:#e8e8f0;
       font:15px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace}
  main{max-width:760px;margin:0 auto}
  h1{font-size:28px;margin:0 0 4px;
     background:linear-gradient(90deg,#c084fc,#67e8f9);
     -webkit-background-clip:text;background-clip:text;color:transparent}
  h2{font-size:15px;margin:36px 0 12px;color:#c084fc;text-transform:uppercase;letter-spacing:.08em}
  .dim{color:#8a8aa0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
  .stat{border:1px solid #26263a;border-radius:10px;padding:14px 16px;background:#12121c}
  .stat .n{font-size:26px;font-weight:700;color:#67e8f9}
  .stat .l{font-size:12px;color:#8a8aa0}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #1d1d2e}
  th{color:#8a8aa0;font-weight:400}
  footer{margin-top:48px;font-size:12px;color:#8a8aa0}
</style></head><body><main>
<h1>SPARDA</h1>
<p class="dim">black box report · ${esc(r.meta.framework)} · ${esc(r.meta.entryFile)} · ${esc(r.generatedAt)}</p>

<h2>Exposure</h2>
<div class="grid">
${stat(`${r.tools.enabled}/${r.tools.total}`, 'tools exposed to AI')}${stat(
    `${r.tools.writesEnabled}/${r.tools.writes}`,
    'write tools opted in',
  )}${stat(r.semantic.workflows, 'workflows learned')}
</div>

<h2>Proof journal (last 100 actions)</h2>
<div class="grid">
${stat(r.proof.events, 'proofed invocations')}${Object.entries(r.proof.byDecision)
    .map(([d, n]) => stat(n, d))
    .join('')}${stat(r.proof.failureCount, 'failure lessons')}
</div>
${
  r.proof.failures.length
    ? `<table><thead><tr><th>signature</th><th>count</th><th>lesson</th></tr></thead>
<tbody>${rows(r.proof.failures, ['sig', 'count', 'lesson'])}</tbody></table>`
    : ''
}

<h2>Immune memory</h2>
<div class="grid">
${stat(r.immunity.antibodies, 'antibodies')}${stat(r.immunity.hits, 'zero-token diagnoses')}
</div>
${
  r.immunity.top.length
    ? `<table><thead><tr><th>signature</th><th>hits</th><th>diagnosis</th></tr></thead>
<tbody>${rows(r.immunity.top, ['sig', 'hits', 'diagnosis'])}</tbody></table>`
    : ''
}

<h2>Emergent organs</h2>
<div class="grid">
${stat(r.organs.circuits, 'circuits observed')}${stat(r.organs.composites.length, 'composite tools born')}
</div>
${
  r.organs.composites.length
    ? `<table><thead><tr><th>composite</th><th>description</th></tr></thead>
<tbody>${rows(r.organs.composites, ['name', 'description'])}</tbody></table>`
    : ''
}

${liveBlock}

<footer>Generated locally by <b>sparda-mcp report</b> — no data left this machine.
SPARDA by Residual Labs · residual-labs.fr</footer>
</main></body></html>`;
}

// ── the command ────────────────────────────────────────────────────────────

export async function runReport(opts) {
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found — nothing to report on.'), {
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

  let live = null;
  const key = resolveSpardaKey(opts.cwd, manifest);
  if (manifest.port && key) {
    live = await fetch(`http://127.0.0.1:${manifest.port}/mcp/stats`, {
      headers: { 'x-sparda-key': key },
      signal: AbortSignal.timeout(1500),
    })
      .then((x) => (x.ok ? x.json() : null))
      .catch(() => null);
  }

  const report = buildReport(manifest, live);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return { report };
  }

  console.log(renderTerminal(report));

  if (opts.html) {
    const outDir = path.join(opts.cwd, '.sparda');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'report.html');
    fs.writeFileSync(outFile, renderHtml(report), 'utf8');
    console.log(`  ✓ HTML report written: ${path.relative(opts.cwd, outFile)}`);
    console.log('');
  }
  return { report };
}

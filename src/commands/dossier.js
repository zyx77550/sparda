// commands/dossier.js — the human face of the proof.
// Everything SPARDA proved about an app, rendered as ONE self-contained HTML file a
// non-technical reader can open and understand: the verdict, the ternary safety
// matrix, the exact risks with file:line, and the frozen capsule. Zero deps, no CDN,
// no network — all CSS inline; deterministic (content derives only from the graph).
// Written to `.sparda/dossier.html`, which is gitignored — ephemeral by design: it
// disappears on `sparda remove` / a clean, so the reader keeps it only if they save it.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../ubg/apocalypse.js';
import { surveyBlindspots } from '../ubg/blindspots.js';
import { buildCapsule } from '../ubg/immunity.js';
import { AXES, POLARITY_SYMBOL, exposedAxes } from '../ubg/polarity.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

export async function runDossier(opts) {
  const compiled = compileUBG(opts.cwd, { write: false, openapi: opts.openapi });
  const canonical = canonicalizeGraph(compiled.graph);
  const { findings, polarity } = checkGraph(canonical);
  const capsule = buildCapsule(canonical);
  const blindspots = surveyBlindspots(canonical, compiled.report);
  const verdict = verdictOf(findings, canonical, { coverage: blindspots.coverage.ratio });

  const data = {
    app: path.basename(path.resolve(opts.cwd)) || 'app',
    framework: compiled.report.framework,
    routes: compiled.report.routes,
    tables: compiled.report.tables,
    nodes: canonical.nodes.length,
    edges: canonical.edges.length,
    provable: verdict.provable,
    proven: verdict.provable && verdict.clean,
    state: verdictState(verdict),
    coverage: Math.round(blindspots.coverage.ratio * 100),
    surfaceOnly: verdict.surfaceOnly,
    guards: verdict.guards,
    guardsVerified: verdict.guardsVerified,
    counts: verdict.counts,
    findings,
    polarity: polarity.map((p) => ({ entrypoint: p.entrypoint, vector: p.vector })),
    posture: capsule.posture,
    capsuleBytes: capsule.bytes,
    blindspots,
    sourceHash: (canonical.meta?.sourceHash ?? '').slice(0, 12),
  };

  const html = renderDossierHTML(data);

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return { data };
  }

  const outPath = path.join(opts.cwd, '.sparda', 'dossier.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  atomicWrite(outPath, html);
  const WORD = {
    PROVEN: '✓ PROVEN',
    PARTIAL: '◑ PROVEN (PARTIAL)',
    RISKY: '⚠ RISKY',
    NOT_PROVEN: '✗ NOT PROVEN',
    SURFACE: '◐ SURFACE ONLY',
    NO_PROOF: '✗ NO PROOF',
  };
  console.log(
    `DOSSIER — ${data.routes} route(s) · coverage ${data.coverage}% · verdict ${WORD[data.state] ?? data.state}`,
  );
  console.log(
    `  written: .sparda/dossier.html (${html.length} bytes, self-contained) — open it in any browser.`,
  );
  console.log(
    `  📸 one screenshotable page — the verdict, the risks, and SPARDA's own blind spots. Share it.`,
  );
  console.log(
    `  ephemeral: .sparda/ is gitignored, so it vanishes on \`sparda remove\` — save it to keep it.`,
  );
  return { data, outPath };
}

// ── pure renderer: proof data → one self-contained HTML document ────────────

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const short = (id) => esc(String(id).replace(/^entrypoint:/, ''));

const SEV_COLOR = {
  critical: '#e5484d',
  high: '#e5484d',
  medium: '#e5a23d',
  info: '#8b8f9a',
};

export function renderDossierHTML(d) {
  // The verdict word comes from the shared state (single source of truth). Back-compat: derive
  // it from the older booleans when a caller passes no `state` (e.g. legacy tests). PARTIAL is
  // honest — a clean proof over only part of the surface never reads as a bare PROVEN.
  const state =
    d.state ??
    (!d.provable
      ? 'NO_PROOF'
      : d.surfaceOnly
        ? 'SURFACE'
        : d.proven
          ? 'PROVEN'
          : 'NOT_PROVEN');
  const verdictClass =
    state === 'PROVEN'
      ? 'ok'
      : state === 'PARTIAL' || state === 'SURFACE' || state === 'RISKY'
        ? 'warn'
        : 'bad';
  const verdictText = {
    PROVEN: 'PROVEN',
    PARTIAL: 'PROVEN (PARTIAL)',
    RISKY: 'RISKY',
    SURFACE: 'SURFACE ONLY — routes seen, no behavior resolved',
    NOT_PROVEN: 'NOT PROVEN',
    NO_PROOF: 'NO PROOF — the app’s routes could not be read',
  }[state];
  const verdictLede = {
    PROVEN:
      'No declared guard, invariant, transaction or aggregate boundary can be broken by this code.',
    PARTIAL: `SPARDA proved the resolved surface (${d.coverage ?? Math.round((d.blindspots?.coverage?.ratio ?? 1) * 100)}%) with 0 violations — but the rest of the app was invisible to static analysis and is UNPROVEN, not safe.`,
    RISKY: `SPARDA found no critical/high risk, but ${d.counts.medium + d.counts.info} finding(s) to review before this is a clean proof.`,
    SURFACE:
      'SPARDA saw the route surface but no state or side-effects behind it — there was nothing to prove. This is NOT a clean bill of health (a spec, or an effect-resolution gap).',
    NOT_PROVEN: `SPARDA found ${d.counts.critical} critical and ${d.counts.high} high risk(s) that must be fixed before this ships.`,
    NO_PROOF:
      'SPARDA could not see this app’s route surface — this is not a clean bill of health.',
  }[state];

  const cell = (v) => {
    const cls = v === -1 ? 'neg' : v === 1 ? 'pos' : 'na';
    return `<td class="${cls}" title="${v === -1 ? 'exposed' : v === 1 ? 'protected' : 'n/a'}">${POLARITY_SYMBOL[v]}</td>`;
  };
  const matrixRows = d.polarity
    .map((p) => {
      const flagged = exposedAxes(p.vector).length ? ' class="row-bad"' : '';
      return `<tr${flagged}><th>${short(p.entrypoint)}</th>${AXES.map((a) => cell(p.vector[a])).join('')}</tr>`;
    })
    .join('');

  const findingCards = d.findings.length
    ? d.findings
        .map(
          (f) => `
        <div class="finding" style="--sev:${SEV_COLOR[f.severity] ?? '#8b8f9a'}">
          <div class="sev">${esc(f.severity)}</div>
          <div class="fbody">
            <div class="frule">${esc(f.rule)} · <span class="fep">${short(f.entrypoint)}</span></div>
            <p>${esc(f.message)}</p>
          </div>
        </div>`,
        )
        .join('')
    : '<p class="clean">No risks found — every proof obligation was discharged.</p>';

  const statCard = (n, label) =>
    `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;

  // The honesty section: where the proof stops. No other prover shows this.
  const b = d.blindspots ?? { spots: [], surface: 0, coverage: { ratio: 1 } };
  const blindRows = b.spots.length
    ? b.spots
        .slice(0, 40)
        .map(
          (s) => `
        <div class="finding" style="--sev:${SEV_COLOR[s.risk] ?? '#8b8f9a'}">
          <div class="sev">${esc(s.risk)}</div>
          <div class="fbody">
            <div class="frule">${esc(s.kind)}${s.location ? ` · <span class="fep">${esc(s.location)}</span>` : ''}</div>
            <p>${esc(s.label)} — ${esc(s.why)}</p>
          </div>
        </div>`,
        )
        .join('')
    : '<p class="clean">Nothing hidden — every route, effect target and guard SPARDA saw was fully resolved.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPARDA dossier — ${esc(d.app)}</title>
<style>
  :root{--bg:oklch(0.16 0.01 255);--panel:oklch(0.22 0.01 255);--line:oklch(0.32 0.01 255);
    --ink:oklch(0.95 0.01 255);--soft:oklch(0.75 0.01 255);--faint:oklch(0.55 0.01 255);
    --red:oklch(0.65 0.20 20);--green:oklch(0.75 0.15 150);--amber:oklch(0.75 0.18 70);
    --mono:"Geist Mono",ui-monospace,Menlo,Consolas,monospace;
    --sans:Inter,Geist,-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;}
  @media(prefers-color-scheme:light){:root{--bg:oklch(0.98 0.005 255);--panel:oklch(1 0 0);
    --line:oklch(0.90 0.01 255);--ink:oklch(0.20 0.01 255);--soft:oklch(0.40 0.01 255);
    --faint:oklch(0.60 0.01 255);--red:oklch(0.55 0.20 20);--green:oklch(0.50 0.15 150);--amber:oklch(0.60 0.18 70);}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased}
  .wrap{max-width:960px;margin:0 auto;padding:48px 24px 80px}
  .top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:16px;font-family:var(--mono);font-size:13px;color:var(--faint)}
  .top b{color:var(--ink);letter-spacing:.12em}
  .hero{padding:48px 0 32px}
  .verdict-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .cov{font-family:var(--mono);font-size:14px;color:var(--faint);padding:10px 18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
  .cov b{color:var(--ink);font-size:18px}
  .stamp{display:inline-flex;align-items:center;gap:12px;font-family:var(--mono);font-weight:700;font-size:16px;padding:12px 24px;border-radius:12px;border:1.5px solid;letter-spacing:.03em;box-shadow:0 4px 12px -4px color-mix(in oklch,currentColor 30%,transparent)}
  .stamp .dot{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in oklch,currentColor 22%,transparent)}
  .ok{color:var(--green);border-color:var(--green);background:color-mix(in oklch,var(--green) 10%,transparent)}
  .bad{color:var(--red);border-color:var(--red);background:color-mix(in oklch,var(--red) 10%,transparent)}
  .warn{color:var(--amber);border-color:var(--amber);background:color-mix(in oklch,var(--amber) 10%,transparent)}
  .hero p{font-size:18px;color:var(--soft);max-width:65ch;margin:24px 0 0;text-wrap:balance}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin:32px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;transition:transform 200ms cubic-bezier(0.16,1,0.3,1),border-color 200ms}
  .stat:hover{transform:translateY(-2px);border-color:var(--soft)}
  .stat b{display:block;font-size:24px;font-family:var(--mono);letter-spacing:-0.02em;line-height:1.2}.stat span{font-size:13px;color:var(--faint);font-weight:500}
  h2{font-size:16px;letter-spacing:-0.01em;margin:48px 0 16px;color:var(--ink)}
  h2 small{color:var(--faint);font-weight:400;font-family:var(--mono)}
  table{border-collapse:collapse;font-family:var(--mono);font-size:13px;width:100%;overflow-x:auto;display:block}
  table thead th{color:var(--faint);font-weight:500;padding:8px 12px;text-align:center;font-size:11px;border-bottom:1px solid var(--line)}
  table tbody th{text-align:left;padding:12px 16px 12px 8px;color:var(--ink);font-weight:500;white-space:nowrap}
  table tbody tr{border-bottom:1px solid var(--line);transition:background-color 150ms}
  table tbody tr:hover{background-color:color-mix(in oklch,var(--panel) 60%,transparent)}
  table td{text-align:center;padding:12px 8px;font-weight:700}
  td.neg{color:var(--red)}td.pos{color:var(--green)}td.na{color:var(--faint)}
  tr.row-bad th{color:var(--red)}
  .finding{display:flex;gap:0;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--sev);border-radius:12px;margin:16px 0;overflow:hidden;transition:transform 200ms cubic-bezier(0.16,1,0.3,1),box-shadow 200ms}
  .finding:hover{transform:translateY(-2px);box-shadow:0 8px 24px -8px color-mix(in oklch,var(--bg) 80%,transparent)}
  .finding .sev{font-family:var(--mono);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--sev);padding:16px;align-self:center}
  .finding .fbody{padding:16px 16px 16px 0}
  .frule{font-family:var(--mono);font-size:13px;color:var(--ink)}.fep{color:var(--faint)}
  .finding p{margin:8px 0 0;font-size:14px;color:var(--soft);line-height:1.6}
  .clean{color:var(--green);font-family:var(--mono)}
  .legend{font-family:var(--mono);font-size:12px;color:var(--faint);margin-top:12px}
  .legend b.pos{color:var(--green)}.legend b.neg{color:var(--red)}
  footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--faint);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
</style></head><body><div class="wrap">
  <div class="top"><b>SPARDA</b><span>AI writes. SPARDA proves.</span></div>

  <section class="hero">
    <div class="verdict-row">
      <span class="stamp ${verdictClass}"><span class="dot"></span>${esc(verdictText)}</span>
      <span class="cov" title="share of the app's behavior SPARDA resolved and reasoned about">coverage&nbsp;<b>${b.coverage ? (b.coverage.ratio * 100).toFixed(0) : (d.coverage ?? 0)}%</b></span>
    </div>
    <p>${esc(verdictLede)}</p>
    <div class="stats">
      ${statCard(d.routes, 'routes')}
      ${statCard((b.coverage.ratio * 100).toFixed(0) + '%', 'behavior resolved')}
      ${statCard(d.nodes, 'graph nodes')}
      ${statCard(d.tables, 'data tables')}
      ${statCard(esc(d.framework), 'framework')}
    </div>
    ${
      d.guards
        ? `<p class="legend">${d.guardsVerified}/${d.guards} guard(s) <b class="pos">verified</b> — SPARDA saw a real deny path in the body; the rest are asserted by name (opaque middleware/decorators it could not read).</p>`
        : ''
    }
  </section>

  <h2>The safety matrix <small>each route × five obligations · − exposed · · n/a · + protected</small></h2>
  <table><thead><tr><th style="text-align:left">route</th>${AXES.map((a) => `<th>${esc(a)}</th>`).join('')}</tr></thead>
  <tbody>${matrixRows || '<tr><td>—</td></tr>'}</tbody></table>
  <p class="legend"><b class="neg">−</b> a protection is missing &nbsp; · &nbsp; the obligation doesn’t apply &nbsp; <b class="pos">+</b> the protection is present</p>

  <h2>What SPARDA found</h2>
  ${findingCards}

  <h2>Where the proof stops <small>SPARDA's own blind spots · coverage ${(b.coverage.ratio * 100).toFixed(0)}% · ${b.surface} unseen, ranked by what each could hide</small></h2>
  ${blindRows}

  <footer>
    <span>graph ${esc(d.sourceHash)} · ${esc(d.nodes)} nodes / ${esc(d.edges)} edges</span>
    <span>generated by SPARDA · residual-labs.fr</span>
  </footer>
</div></body></html>`;
}

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
import { checkGraph, verdictOf } from '../ubg/apocalypse.js';
import { buildCapsule } from '../ubg/immunity.js';
import { AXES, POLARITY_SYMBOL, exposedAxes } from '../ubg/polarity.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

export async function runDossier(opts) {
  const compiled = compileUBG(opts.cwd, { write: false, openapi: opts.openapi });
  const canonical = canonicalizeGraph(compiled.graph);
  const { findings, polarity } = checkGraph(canonical);
  const verdict = verdictOf(findings, canonical);
  const capsule = buildCapsule(canonical);

  const data = {
    app: path.basename(path.resolve(opts.cwd)) || 'app',
    framework: compiled.report.framework,
    routes: compiled.report.routes,
    tables: compiled.report.tables,
    nodes: canonical.nodes.length,
    edges: canonical.edges.length,
    provable: verdict.provable,
    proven: verdict.provable && verdict.clean,
    surfaceOnly: verdict.surfaceOnly,
    guards: verdict.guards,
    guardsVerified: verdict.guardsVerified,
    counts: verdict.counts,
    findings,
    polarity: polarity.map((p) => ({ entrypoint: p.entrypoint, vector: p.vector })),
    posture: capsule.posture,
    capsuleBytes: capsule.bytes,
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
  console.log(
    `DOSSIER — ${data.routes} route(s), verdict ${data.proven ? '✓ PROVEN' : data.provable ? '✗ NOT PROVEN' : '✗ NO PROOF'}`,
  );
  console.log(
    `  written: .sparda/dossier.html (${html.length} bytes, self-contained) — open it in any browser.`,
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
  const verdictClass = d.proven ? 'ok' : d.surfaceOnly ? 'warn' : 'bad';
  const verdictText = d.proven
    ? 'PROVEN'
    : d.surfaceOnly
      ? 'SURFACE ONLY — routes seen, no behavior resolved'
      : d.provable
        ? 'NOT PROVEN'
        : 'NO PROOF — the app’s routes could not be read';
  const verdictLede = d.proven
    ? 'No declared guard, invariant, transaction or aggregate boundary can be broken by this code.'
    : d.surfaceOnly
      ? 'SPARDA saw the route surface but no state or side-effects behind it — there was nothing to prove. This is NOT a clean bill of health (a spec, or an effect-resolution gap).'
      : d.provable
        ? `SPARDA found ${d.counts.critical} critical and ${d.counts.high} high risk(s) that must be fixed before this ships.`
        : 'SPARDA could not see this app’s route surface — this is not a clean bill of health.';

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

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPARDA dossier — ${esc(d.app)}</title>
<style>
  :root{--bg:#0d0e12;--panel:#14161c;--line:#262a34;--ink:#e8eaf0;--soft:#a4a9b8;
    --faint:#6b7183;--red:#f0575c;--green:#3dd68c;--amber:#e5a23d;--mono:ui-monospace,Menlo,Consolas,monospace;
    --sans:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;}
  @media(prefers-color-scheme:light){:root{--bg:#f4f2ee;--panel:#fff;--line:#e3ded5;
    --ink:#191b21;--soft:#4c5160;--faint:#838a99;--red:#cf3b40;--green:#17915b;--amber:#b47617;}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55}
  .wrap{max-width:900px;margin:0 auto;padding:32px 22px 64px}
  .top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:14px;font-family:var(--mono);font-size:13px;color:var(--faint)}
  .top b{color:var(--ink);letter-spacing:.12em}
  .hero{padding:34px 0 22px}
  .stamp{display:inline-flex;align-items:center;gap:11px;font-family:var(--mono);font-weight:700;font-size:16px;padding:10px 18px;border-radius:9px;border:1.5px solid;letter-spacing:.03em}
  .stamp .dot{width:9px;height:9px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 22%,transparent)}
  .ok{color:var(--green);border-color:var(--green);background:color-mix(in srgb,var(--green) 9%,transparent)}
  .bad{color:var(--red);border-color:var(--red);background:color-mix(in srgb,var(--red) 9%,transparent)}
  .warn{color:var(--amber);border-color:var(--amber);background:color-mix(in srgb,var(--amber) 9%,transparent)}
  .hero p{font-size:18px;color:var(--soft);max-width:60ch;margin:18px 0 0}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:96px}
  .stat b{display:block;font-size:22px;font-family:var(--mono)}.stat span{font-size:12px;color:var(--faint)}
  h2{font-size:15px;letter-spacing:.02em;margin:38px 0 12px;color:var(--ink)}
  h2 small{color:var(--faint);font-weight:400;font-family:var(--mono)}
  table{border-collapse:collapse;font-family:var(--mono);font-size:13px;width:100%;overflow-x:auto;display:block}
  table thead th{color:var(--faint);font-weight:500;padding:6px 8px;text-align:center;font-size:11px}
  table tbody th{text-align:left;padding:6px 10px 6px 0;color:var(--ink);font-weight:500;white-space:nowrap}
  table td{text-align:center;padding:6px 8px;font-weight:700}
  td.neg{color:var(--red)}td.pos{color:var(--green)}td.na{color:var(--faint)}
  tr.row-bad th{color:var(--red)}
  .finding{display:flex;gap:0;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--sev);border-radius:10px;margin:10px 0;overflow:hidden}
  .finding .sev{font-family:var(--mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--sev);padding:14px 12px;align-self:center}
  .finding .fbody{padding:12px 14px 12px 0}
  .frule{font-family:var(--mono);font-size:12.5px;color:var(--ink)}.fep{color:var(--faint)}
  .finding p{margin:6px 0 0;font-size:14px;color:var(--soft)}
  .clean{color:var(--green);font-family:var(--mono)}
  .legend{font-family:var(--mono);font-size:12px;color:var(--faint);margin-top:8px}
  .legend b.pos{color:var(--green)}.legend b.neg{color:var(--red)}
  footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11px;color:var(--faint);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
</style></head><body><div class="wrap">
  <div class="top"><b>SPARDA</b><span>AI writes. SPARDA proves.</span></div>

  <section class="hero">
    <span class="stamp ${verdictClass}"><span class="dot"></span>${esc(verdictText)}</span>
    <p>${esc(verdictLede)}</p>
    <div class="stats">
      ${statCard(d.routes, 'routes')}
      ${statCard(d.nodes, 'graph nodes')}
      ${statCard(d.tables, 'data tables')}
      ${statCard(d.capsuleBytes + ' B', 'safety capsule')}
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

  <footer>
    <span>graph ${esc(d.sourceHash)} · ${esc(d.nodes)} nodes / ${esc(d.edges)} edges</span>
    <span>generated by SPARDA · residual-labs.fr</span>
  </footer>
</div></body></html>`;
}

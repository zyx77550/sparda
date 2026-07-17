// commands/badge.js — the shareable artifact (URGENT-ADOPTION J3-4). The move that converts a
// download into a star (Codecov/Lighthouse): the result is a badge the user pins proudly in
// their README. A self-contained SVG (no external fetch — the product's zero-infra ethos) plus
// a paste-ready markdown block. The verdict word comes from the SAME source as `prove`
// (verdictState), so the public badge can NEVER over-claim: a 23%-resolved app reads PARTIAL,
// never a bare PROVEN. `--out <file>` redirects the SVG; `--json` emits the badge data for CI.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, verdictOf, badgeFor } from '../ubg/apocalypse.js';
import { surveyBlindspots } from '../ubg/blindspots.js';

export async function runBadge(opts) {
  const { graph, report } = compileUBG(opts.cwd, { write: false });
  const canonical = canonicalizeGraph(graph);
  const { findings } = checkGraph(canonical);
  const blind = surveyBlindspots(canonical, report);
  const verdict = verdictOf(findings, canonical, { coverage: blind.coverage.ratio });
  const cov = Math.round(blind.coverage.ratio * 100);
  const { state, message, color } = badgeFor(verdict, { coverage: blind.coverage.ratio });

  const svg = renderBadge('SPARDA', message, color);
  const outPath = opts.out
    ? path.resolve(opts.cwd, opts.out)
    : path.join(opts.cwd, '.sparda', 'badge.svg');

  const data = {
    verdict: state,
    coverage: cov,
    routes: report.routes,
    guards: verdict.guards,
    guardsVerified: verdict.guardsVerified,
    findings: findings.filter((f) => !f.advisory).length,
    color,
    message,
  };

  if (opts.json) {
    console.log(JSON.stringify({ ...data, svgPath: rel(outPath, opts.cwd) }, null, 2));
    return { data };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg);

  const relSvg = rel(outPath, opts.cwd);
  // shields.io endpoint alternative — same values, for users who prefer a hosted badge
  const shields = `https://img.shields.io/badge/SPARDA-${encodeURIComponent(message)}-${color.slice(1)}`;

  console.log(
    `\n✓ Badge written: ${relSvg}  (${state} · ${report.routes} routes · ${cov}% coverage)`,
  );
  console.log(`\nPaste into your README:\n`);
  console.log(`  ![SPARDA](./${relSvg})`);
  console.log(`\nOr use the shields.io endpoint (no committed file):\n`);
  console.log(`  ![SPARDA](${shields})`);
  console.log('');
  return { data, svgPath: relSvg };
}

// A shields-style two-part "flat" badge, fully self-contained. Deterministic width from a
// Verdana-ish per-char estimate — pixel-perfection is not the point, a clean readable badge is.
function renderBadge(label, message, color) {
  const lw = textWidth(label);
  const mw = textWidth(message);
  const PAD = 6;
  const lWidth = lw + 2 * PAD;
  const mWidth = mw + 2 * PAD;
  const total = lWidth + mWidth;
  const h = 20;
  // ×10 coords: shields renders text at a 10× scale then scales down, for crisp positioning
  const lx = (lWidth / 2) * 10;
  const mx = (lWidth + mWidth / 2) * 10;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(message)}">
  <title>${esc(label)}: ${esc(message)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lWidth}" height="${h}" fill="#555"/>
    <rect x="${lWidth}" width="${mWidth}" height="${h}" fill="${color}"/>
    <rect width="${total}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${lw * 10}">${esc(label)}</text>
    <text x="${lx}" y="140" transform="scale(.1)" textLength="${lw * 10}">${esc(label)}</text>
    <text x="${mx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${mw * 10}">${esc(message)}</text>
    <text x="${mx}" y="140" transform="scale(.1)" textLength="${mw * 10}">${esc(message)}</text>
  </g>
</svg>
`;
}

// Verdana 11px approximate advance widths — wide enough to avoid clipping, narrow enough to
// look tight. Digits/lowercase ~7, uppercase ~8.5, punctuation/space narrower.
function textWidth(s) {
  let w = 0;
  for (const ch of s) {
    if (/[A-Z]/.test(ch)) w += 8.5;
    else if (/[a-z0-9]/.test(ch)) w += 7;
    else if (ch === ' ') w += 4;
    else if (ch === '·') w += 5;
    else if (ch === '%') w += 11;
    else w += 5;
  }
  return Math.ceil(w);
}

const rel = (abs, cwd) =>
  abs.startsWith(cwd) ? abs.slice(cwd.length + 1).replaceAll('\\', '/') : abs;

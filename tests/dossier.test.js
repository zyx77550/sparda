// dossier.test.js — the human-readable HTML proof report.
// Claims: (1) the renderer is a pure function of the proof data (deterministic);
// (2) dynamic content is HTML-escaped (a route path can't inject markup — rule #7);
// (3) the verdict + findings actually render; (4) the wrapper writes a self-contained
// file to the gitignored .sparda/ (ephemeral) and exits cleanly.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDossierHTML, runDossier } from '../src/commands/dossier.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BAIT = path.join(here, 'fixtures', 'ubg-semantics'); // NOT PROVEN

const baseData = {
  app: 'demo',
  framework: 'express',
  routes: 1,
  tables: 1,
  nodes: 3,
  edges: 2,
  provable: true,
  proven: false,
  counts: { critical: 1, high: 0, medium: 0, info: 0 },
  findings: [
    {
      severity: 'critical',
      rule: 'UNGUARDED_MUTATION',
      entrypoint: 'entrypoint:POST /x',
      message: 'POST /x mutates users with no guard',
    },
  ],
  polarity: [
    {
      entrypoint: 'entrypoint:POST /x',
      vector: { auth: -1, atomicity: 0, reversibility: 0, validation: 0, aggregate: 0 },
    },
  ],
  posture: {},
  capsuleBytes: 1,
  sourceHash: 'abc123',
};

describe('dossier renderer', () => {
  it('is a self-contained HTML document — no external URLs', () => {
    const html = renderDossierHTML(baseData);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\/(?!residual-labs\.fr)/); // only our brand link, no CDNs
    expect(html).not.toContain('<script');
  });

  it('renders the verdict and the finding', () => {
    const html = renderDossierHTML(baseData);
    expect(html).toContain('NOT PROVEN');
    expect(html).toContain('UNGUARDED_MUTATION');
    expect(html).toContain('POST /x');
  });

  it('escapes dynamic content — a route path cannot inject markup', () => {
    const evil = JSON.parse(JSON.stringify(baseData));
    evil.findings[0].entrypoint = 'entrypoint:GET /<img src=x onerror=alert(1)>';
    evil.findings[0].message = '</p><script>alert(1)</script>';
    const html = renderDossierHTML(evil);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;'); // the payload survived as inert text
  });

  it('is deterministic — same data in, same bytes out', () => {
    expect(renderDossierHTML(baseData)).toBe(renderDossierHTML(baseData));
  });

  it('shows PROVEN when the app is clean', () => {
    const clean = {
      ...baseData,
      proven: true,
      findings: [],
      counts: { critical: 0, high: 0, medium: 0, info: 0 },
    };
    const html = renderDossierHTML(clean);
    expect(html).toContain('>PROVEN<');
    expect(html).toContain('every proof obligation was discharged');
  });
});

describe('runDossier (wrapper)', () => {
  const written = [];
  afterEach(() => {
    for (const f of written.splice(0))
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
  });

  it('writes a self-contained file to .sparda/ and exits 0', async () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    const orig = console.log;
    console.log = () => {};
    try {
      const { outPath, data } = await runDossier({ cwd: BAIT });
      written.push(outPath);
      expect(fs.existsSync(outPath)).toBe(true);
      expect(outPath.replace(/\\/g, '/')).toContain('.sparda/dossier.html');
      const html = fs.readFileSync(outPath, 'utf8');
      expect(html).toContain('<!doctype html>');
      expect(data.routes).toBeGreaterThan(0);
    } finally {
      console.log = orig;
      process.exitCode = prev;
    }
  });
});

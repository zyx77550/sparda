// badge.test.js — the shareable artifact (URGENT-ADOPTION J3-4). Pins that the badge is a
// self-contained, valid SVG whose word/colour come from the SAME verdict source as `prove`
// (verdictState) — so the public badge can NEVER over-claim (a PARTIAL app is yellow, never a
// false green), and its --json is CI-consumable.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBadge } from '../src/commands/badge.js';
import { verdictState } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);

describe('sparda badge', () => {
  it('emits CI-consumable JSON with the shared verdict word and honest coverage', async () => {
    const log = [];
    const spy = console.log;
    console.log = (s) => log.push(s);
    let data;
    try {
      ({ data } = await runBadge({ cwd: fix('ubg-medusa'), json: true }));
    } finally {
      console.log = spy;
    }
    const printed = JSON.parse(log.join('\n'));
    expect(printed.verdict).toBe(data.verdict);
    expect(['PROVEN', 'PARTIAL', 'RISKY', 'NOT_PROVEN', 'SURFACE', 'NO_PROOF']).toContain(
      printed.verdict,
    );
    expect(typeof printed.coverage).toBe('number');
    // the colour is a claim: green ONLY for a complete PROVEN
    if (printed.verdict !== 'PROVEN') expect(printed.color).not.toBe('#4c1');
  });

  it('writes a self-contained, valid SVG (no external fetch)', async () => {
    const out = path.join(os.tmpdir(), `sparda-badge-${Date.now()}.svg`);
    const spy = console.log;
    console.log = () => {};
    try {
      await runBadge({ cwd: fix('ubg-medusa'), out });
    } finally {
      console.log = spy;
    }
    const svg = fs.readFileSync(out, 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    // zero-infra ethos: no external RESOURCE fetch (the xmlns namespace URI is not a fetch —
    // what must be absent is an <image>, <use href>, <script src>, or a remote asset host)
    expect(svg).not.toMatch(/<image\b|xlink:href|<script|href\s*=|shields\.io/i);
    fs.rmSync(out, { force: true });
  });

  it('verdictState is the single source of truth (badge cannot disagree with prove)', () => {
    // a clean but low-coverage verdict is PARTIAL, never PROVEN — the anti-overclaim invariant
    expect(verdictState({ provable: true, clean: true, partial: true })).toBe('PARTIAL');
    expect(verdictState({ provable: true, clean: true, partial: false })).toBe('PROVEN');
    expect(verdictState({ provable: false })).toBe('NO_PROOF');
  });
});

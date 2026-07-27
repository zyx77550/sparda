// dynamic-registration.test.js — E-063 (Y3): registrations that escape classical
// static analysis — computed verbs (app[v](…)), Reflect.apply, .apply/.call over a
// registration verb — used to vanish silently (and app[v] could even be MISREAD as
// a static verb). Each now yields an UnknownHandler object plus a HIGH-risk
// skipped-surface entry: the certainty score degrades, the surface never lies.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-dynamic-registration');

const { report } = compileUBG(FIX, { write: false });

describe('dynamic registrations become UnknownHandlers (E-063)', () => {
  it('emits one UnknownHandler per statically-unbindable registration', () => {
    const vias = (report.unknownHandlers ?? []).map((u) => u.via).sort();
    expect(vias).toEqual(['apply-call', 'computed-method', 'reflect-apply']);
    for (const u of report.unknownHandlers) {
      expect(u.kind).toBe('UnknownHandler');
      expect(u.target).toBe('app');
      expect(u.file).toMatch(/app\.js$/);
    }
  });

  it('each dynamic registration is a HIGH-risk skipped surface — certainty degrades', () => {
    const dynamic = report.skipped.filter((s) =>
      s.reason.includes('dynamic registration'),
    );
    expect(dynamic.length).toBe(3);
    for (const s of dynamic) expect(s.risk).toBe('high');
  });

  it('the plain route beside them is still extracted', () => {
    expect(report.routes).toBe(1); // GET /plain — the dynamic ones are honest unknowns
  });
});

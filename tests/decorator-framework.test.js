// decorator-framework.test.js — ADR-055: recognize the PROTOCOL, not the framework.
// This fixture is a BESPOKE framework — @RestController / @Get / @Post defined locally,
// no @nestjs, no @Controller anywhere. SPARDA must still (1) DETECT it as a decorator
// app (verb decorators + reflect-metadata, brand-free), (2) read its routes by the HTTP
// verb, (3) infer its GUARDED-BY-DEFAULT posture from the presence of a `skipAuth`
// opt-out — so the registry-authenticated write is clean and only the opt-out public
// write is flagged — and (4) resolve the DI write underneath. The whole n8n story in a
// fixture.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/detect.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-decorator-framework');
const graphOf = () => canonicalizeGraph(compileUBG(APP, { write: false }).graph);
const unguarded = (g) =>
  checkGraph(g)
    .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

describe('bespoke decorator framework — recognize HTTP, not the brand', () => {
  it('detects a decorator app with no @nestjs, by structure', () => {
    expect(detectStack(APP).framework).toBe('nestjs');
  });

  it('reads routes by the HTTP verb across brand-free @RestController classes', () => {
    const eps = graphOf()
      .nodes.filter((n) => n.kind === 'entrypoint')
      .map((n) => n.id);
    expect(eps).toContain('entrypoint:GET /things/');
    expect(eps).toContain('entrypoint:POST /things/');
    expect(eps).toContain('entrypoint:GET /users/');
  });

  it('infers guarded-by-default: the registry-authed write is NOT flagged', () => {
    // @Post('/things/') has no guard decorator, but the app is guarded-by-default
    // (a skipAuth opt-out exists elsewhere) → the registry authenticates it.
    expect(unguarded(graphOf())).not.toContain('entrypoint:POST /things/');
  });

  it('flags ONLY the skipAuth opt-out public write (the true positive)', () => {
    const u = unguarded(graphOf());
    expect(u).toContain('entrypoint:POST /things/import');
    expect(u).toHaveLength(1);
  });

  it('resolves the DI write underneath (this.service.create → prisma.thing.create)', () => {
    const effects = graphOf().nodes.filter((n) => n.kind === 'effect');
    expect(effects.some((n) => n.meta.table === 'thing')).toBe(true);
  });

  it('is deterministic across runs', () => {
    expect(JSON.stringify(graphOf())).toBe(JSON.stringify(graphOf()));
  });
});

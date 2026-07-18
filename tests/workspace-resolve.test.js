// workspace-resolve.test.js — P1 / E-048, the mycorrhizal network. A monorepo app's real
// mutation logic lives in shared workspace packages it imports BY NAME (`@acme/data`), not by
// path — the code is in a sibling package, outside the analyzed app dir. Without workspace
// resolution the cross-package hop dead-ends and the effect is BLIND (cal.com/api/v2: 46
// guarded mutations whose writes never resolved). These tests pin the resolver: it maps a
// workspace package name to its real directory, resolves subpaths, and threads through a
// barrel re-export to the leaf module — while a real npm package still resolves to nothing.
//
// End-to-end proof lives on the corpus, not here: on cal.com/apps/api/v2 (175 routes) this
// resolver lifts coverage 71% → 87% and surfaces real unguarded mutations that were invisible
// (POST /verification/email/send-code — no @UseGuards) — the A/B is recorded in docs/ERRORS.md
// (E-048). The synthetic effect-follower for a bare-function idiom is a separate, pre-existing
// path; this file tests the unit of work that changed — module resolution.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRelImport, parseModule, clearModuleCache } from '../src/ubg/extract.js';
import { parsePrismaSchemas } from '../src/ubg/prisma.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WS = path.join(here, 'fixtures', 'ubg-workspace');
const p = (...seg) => path.join(WS, ...seg);
const appFile = p('packages', 'api', 'src', 'app.js');

describe('workspace-package resolution (E-048)', () => {
  it('maps @scope/pkg to its package dir, and subpaths to files under it', () => {
    clearModuleCache();
    expect(resolveRelImport(appFile, '@acme/data')).toBe(
      p('packages', 'data', 'src', 'index.js'),
    );
    expect(resolveRelImport(appFile, '@acme/data/src/models')).toBe(
      p('packages', 'data', 'src', 'models.js'),
    );
  });

  it('a real npm package (not in the workspace) still resolves to nothing', () => {
    clearModuleCache();
    expect(resolveRelImport(appFile, '@nestjs/common')).toBe(null);
    expect(resolveRelImport(appFile, 'express')).toBe(null);
  });

  it('threads through a barrel: `{ orderService }` from @acme/data → the leaf service file', () => {
    clearModuleCache();
    const controller = parseModule(
      p('packages', 'api', 'src', 'controllers', 'order.controller.js'),
    );
    // the destructured import crosses the workspace boundary AND the package's own barrel
    // re-export (`module.exports.orderService = require('./order.service')`), landing on the
    // module that actually owns the write — not a dead-end at index.js.
    expect(controller.imports.get('orderService')).toBe(
      p('packages', 'data', 'src', 'order.service.js'),
    );
  });

  it('the leaf service resolves its own model import within the sibling package', () => {
    clearModuleCache();
    const service = parseModule(p('packages', 'data', 'src', 'order.service.js'));
    expect(service.imports.get('Order')).toBe(p('packages', 'data', 'src', 'models.js'));
  });
});

// P4 — the mycorrhizal network for STATE. An app that declares NO schema of its own but depends
// on a shared workspace `@acme/db` must have that package's schema parsed as its state layer —
// otherwise every mutation reasons against nothing (cal.com/apps/web: 0 tables locally, 100 in
// @calcom/prisma). Measured on cal.com/web: state layer 0 → 100 tables, coverage 87% → 95%.
describe('workspace schema resolution (P4)', () => {
  it('parses a shared @scope/db schema the app depends on but does not contain', () => {
    clearModuleCache();
    const { tables, sourceFile } = parsePrismaSchemas(p('packages', 'api'));
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(['order', 'user']);
    expect(sourceFile).toContain('db/prisma/schema.prisma'); // resolved across the workspace
  });

  it('a cross-file enum still becomes a CHECK invariant across the boundary', () => {
    clearModuleCache();
    const { tables } = parsePrismaSchemas(p('packages', 'api'));
    const order = tables.find((t) => t.name === 'order');
    const check = (order.invariants ?? []).find((i) => i.type === 'check');
    expect(check?.expression).toContain('status in');
    expect(check?.expression).toContain('pending');
  });
});

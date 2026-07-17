// prisma-folder.test.js — E-046 regression + the BolaRay ownership-model enrichment.
// (1) A Prisma app using the split-schema FOLDER layout (prisma/schema/*.prisma, no single
// schema.prisma) must have its whole state layer parsed — models split across files, enums
// referenced cross-file. (2) The O7 BOLA advisory must name each accessed table's inferred
// ownership model ("direct-owner (userid)"), so the advisory is actionable, not vague.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrismaSchemas } from '../src/ubg/prisma.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-prisma-folder');

describe('E-046 — Prisma split-schema folder', () => {
  it('parses every model across the folder (no single schema.prisma)', () => {
    const { tables, sourceFile } = parsePrismaSchemas(FIX);
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain('user');
    expect(names).toContain('link');
    expect(sourceFile).toBe('prisma/schema'); // the folder, not a single file
  });

  it('resolves a cross-file enum reference (enum in base.prisma, used in link.prisma)', () => {
    const { tables } = parsePrismaSchemas(FIX);
    const link = tables.find((t) => t.name === 'link');
    // the LinkStatus enum (declared in a DIFFERENT file) must become a CHECK invariant
    const check = (link.invariants ?? []).find((i) => i.type === 'check');
    expect(check?.expression).toContain('status in');
    expect(check?.expression).toContain('active');
  });
});

describe('BOLA advisory — ownership-model enrichment (BolaRay step 1)', () => {
  it('names the missing scope: link should be direct-owner (userid)', () => {
    const { graph } = compileUBG(FIX, { write: false });
    const { findings } = checkGraph(canonicalizeGraph(graph));
    const bola = findings.find((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN');
    expect(bola).toBeTruthy(); // guarded, id-scoped read of Link, no ownership binding
    const linkModel = bola.ownership?.find((o) => o.table === 'link');
    expect(linkModel?.model).toBe('direct-owner');
    expect(linkModel?.key).toBe('userid');
    expect(bola.message).toContain('link should be direct-owner (userid)');
  });
});

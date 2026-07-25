// typeorm.test.js — TypeORM write resolution via repository provenance.
// Before this, a NestJS+TypeORM app (one of the most common enterprise stacks) resolved to
// SURFACE: `this.repo.save(dto)` went through an injected repository whose write verbs the ORM
// handlers didn't know, so no mutation was seen and nothing could be proven. Repository
// provenance labels the field from `@InjectRepository(User)` / `Repository<User>` (and a local
// `getRepository(User)` var), so a write verb on it resolves to a db_write on the entity table.
// A generic `.save()` on an unknown object must NOT fire.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NEST_FIX = path.join(here, 'fixtures', 'ubg-typeorm-nest');

const compiled = (() => {
  const { graph } = compileUBG(NEST_FIX, { write: false });
  const g = canonicalizeGraph(graph);
  const { findings } = checkGraph(g);
  return { g, findings, verdict: verdictOf(findings, g) };
})();

describe('TypeORM: NestJS injected repository', () => {
  it('resolves this.repo.save/delete through the DI hop as db_writes on the entity table', () => {
    const writes = compiled.g.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    expect(writes.length).toBe(2);
    expect(writes.every((w) => w.meta.table === 'user')).toBe(true);
    expect(writes.map((w) => w.meta.op).sort()).toEqual(['delete', 'insert']);
  });

  it('is not surface-only — the ORM behavior was resolved', () => {
    expect(compiled.verdict.surfaceOnly).toBe(false);
  });

  it('catches the unguarded DELETE and clears the @UseGuards-protected POST', () => {
    const unguarded = compiled.findings.filter(
      (f) => f.rule === 'UNGUARDED_MUTATION' && !f.advisory,
    );
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0].entrypoint).toMatch(/DELETE/);
  });
});

describe('TypeORM: local getRepository var + no-false-positive', () => {
  const mk = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-typeorm-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'p',
        type: 'module',
        main: 'src/app.js',
        dependencies: { express: '^4.19.0', typeorm: '^0.3' },
      }),
    );
    for (const [f, c] of Object.entries(files))
      fs.writeFileSync(path.join(dir, 'src', f), c);
    const { graph } = compileUBG(dir, { write: false });
    return canonicalizeGraph(graph).nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
  };

  it('resolves a local const repo = getRepository(User) write', () => {
    const writes = mk({
      'user.entity.js': 'export class User {}',
      'app.js':
        'import express from "express";\n' +
        'import { getRepository } from "typeorm";\n' +
        'import { User } from "./user.entity.js";\n' +
        'const app = express();\n' +
        'app.post("/u", async (req, res) => { const repo = getRepository(User); await repo.save({ n: req.body.n }); res.json({}); });\n' +
        'app.listen(3000);\n',
    });
    expect(writes.some((w) => w.meta.table === 'user')).toBe(true);
  });

  it('does NOT fire on a generic .save() on an unknown object (no false positive)', () => {
    const writes = mk({
      'app.js':
        'import express from "express";\n' +
        'const app = express(); const session = {};\n' +
        'app.post("/s", async (req, res) => { await session.save(); res.json({}); });\n' +
        'app.listen(3000);\n',
    });
    expect(writes).toHaveLength(0);
  });
});

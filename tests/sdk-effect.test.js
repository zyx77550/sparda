// sdk-effect.test.js — innate immunity (PAMP receptor) for vendor-SDK effects.
// Audit blind spot #1: `stripe.charges.create()` charges a card but wears no fetch/
// http-client skin, so it resolved to nothing and O4 (irreversibility) never fired on
// real payment code. The receptor recognizes a small set of CONSERVED vendor call SHAPES
// directly (deterministic, zero-LLM). This locks: (1) the SDK charge becomes an observable
// http_call, (2) O4 fires IRREVERSIBLE_OBSERVABLE, (3) no false positive on a plain ORM app.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SDK_FIX = path.join(here, 'fixtures', 'ubg-sdk-effect');
const PROVEN_FIX = path.join(here, 'fixtures', 'ubg-proven');

const compile = (dir) => {
  const { graph } = compileUBG(dir, { write: false });
  const c = canonicalizeGraph(graph);
  return { graph: c, findings: checkGraph(c).findings };
};

describe('innate immunity: vendor-SDK effect receptor', () => {
  const { graph, findings } = compile(SDK_FIX);

  it('resolves stripe.charges.create as an observable http_call', () => {
    const http = graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'http_call',
    );
    expect(http).toHaveLength(1);
    expect(http[0].meta.target).toBe('sdk:charges.create');
    // POST → the effect algebra must mark it observable (visible to the outside world)
    expect(http[0].meta.observable).toBe(true);
    expect(http[0].meta.compensable).toBe(false);
  });

  it('fires IRREVERSIBLE_OBSERVABLE — the charge + DB write with no compensation', () => {
    const o4 = findings.filter((f) => f.rule === 'IRREVERSIBLE_OBSERVABLE');
    expect(o4).toHaveLength(1);
    expect(o4[0].severity).toBe('high');
  });

  it('does NOT misread a plain ORM write as an SDK effect (no false positive)', () => {
    const { graph: clean } = compile(PROVEN_FIX);
    const http = clean.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'http_call',
    );
    expect(http).toHaveLength(0);
  });
});

// The AWS SDK v3 shape — `client.send(new PutObjectCommand(...))` — names the effect via the
// command class in the argument, not the generic `.send` verb. A plain `.send()` must NOT fire.
describe('AWS SDK v3 command-shaped effects', () => {
  const mkApp = (body) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-awsv3-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'p',
        type: 'module',
        main: 'src/app.js',
        dependencies: { express: '^4.19.0' },
      }),
    );
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), body);
    const { graph } = compileUBG(dir, { write: false });
    return canonicalizeGraph(graph).nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'http_call',
    );
  };

  it('resolves client.send(new PutObjectCommand(...)) as an observable http_call', () => {
    const http = mkApp(
      'import express from "express";\n' +
        'import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";\n' +
        'const app = express(); const s3 = new S3Client({});\n' +
        'app.post("/u", async (req, res) => { await s3.send(new PutObjectCommand({ Bucket: "b" })); res.json({}); });\n' +
        'app.listen(3000);\n',
    );
    expect(http).toHaveLength(1);
    expect(http[0].meta.target).toBe('sdk:putobjectcommand');
    expect(http[0].meta.observable).toBe(true);
  });

  it('does NOT fire on a plain .send() with no known command (no false positive)', () => {
    const http = mkApp(
      'import express from "express";\n' +
        'const app = express(); const bus = {};\n' +
        'app.post("/u", async (req, res) => { await bus.send({ hello: 1 }); res.json({}); });\n' +
        'app.listen(3000);\n',
    );
    expect(http).toHaveLength(0);
  });
});

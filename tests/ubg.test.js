// ubg.test.js — the UBG compiler contract: right nodes, right edges, right
// passes, byte-deterministic output.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { parseSqlSchemas } from '../src/ubg/sql.js';
import {
  createGraph,
  addNode,
  addEdge,
  makeNode,
  makeEdge,
  validateGraph,
  canonicalizeGraph,
} from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPRESS_FIXTURE = path.join(here, 'fixtures', 'ubg-express');
const NEXT_FIXTURE = path.join(here, 'fixtures', 'nextjs-basic');
const FASTAPI_FIXTURE = path.join(here, 'fixtures', 'ubg-fastapi');

const hasPython = (() => {
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
      const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 3000 });
      if (res.status === 0) return true;
    } catch {
      // keep probing
    }
  }
  return false;
})();

const nodesOf = (graph, kind) => [...graph.nodes.values()].filter((n) => n.kind === kind);
const edgesOf = (graph, kind) => graph.edges.filter((e) => e.kind === kind);

describe('UBG: SQL schema parser', () => {
  it('extracts tables, columns, normalized types and pks', () => {
    const { tables } = parseSqlSchemas(EXPRESS_FIXTURE);
    expect(tables.map((t) => t.name)).toEqual(['audit_log', 'users']);

    const users = tables.find((t) => t.name === 'users');
    const byName = Object.fromEntries(users.columns.map((c) => [c.name, c]));
    expect(byName.id.type).toBe('number');
    expect(byName.id.pk).toBe(true);
    expect(byName.email.type).toBe('string');
    expect(byName.email.nullable).toBe(false);
    expect(byName.active.type).toBe('boolean');

    // DECIMAL(10,2) must survive the top-level comma split
    const audit = tables.find((t) => t.name === 'audit_log');
    const amount = audit.columns.find((c) => c.name === 'amount');
    expect(amount.sqlType).toBe('decimal(10,2)');
    expect(amount.type).toBe('number');
  });
});

describe('UBG: Express compilation', () => {
  const { graph, report } = compileUBG(EXPRESS_FIXTURE, { write: false });

  it('produces every node kind', () => {
    for (const kind of ['entrypoint', 'logic', 'state', 'effect', 'guard'])
      expect(nodesOf(graph, kind).length, kind).toBeGreaterThan(0);
  });

  it('compiles both routes into entrypoints', () => {
    const ids = nodesOf(graph, 'entrypoint').map((n) => n.id);
    expect(ids).toContain('entrypoint:GET /users/:id');
    expect(ids).toContain('entrypoint:POST /users');
  });

  it('classifies requireAuth as a guard and gates the handler', () => {
    const guard = nodesOf(graph, 'guard').find((n) => n.label === 'requireAuth');
    expect(guard).toBeDefined();
    expect(guard.meta.guardType).toBe('denies-unauthorized');
    const gates = edgesOf(graph, 'gate').filter((e) => e.from === guard.id);
    expect(gates).toHaveLength(1);
    expect(graph.nodes.get(gates[0].to).meta.role).toBe('handler');
  });

  it('links the INSERT to the users state node as a mutation', () => {
    const mutations = edgesOf(graph, 'mutation');
    expect(mutations).toHaveLength(1);
    expect(mutations[0].to).toBe('state:sql:users');
    expect(mutations[0].meta.op).toBe('insert');
    expect(graph.nodes.get(mutations[0].from).meta.effectType).toBe('db_write');
  });

  it('links the SELECT as data_flow from state into the read effect', () => {
    const reads = edgesOf(graph, 'data_flow').filter(
      (e) => e.from === 'state:sql:users' && e.meta.via === 'rows',
    );
    expect(reads).toHaveLength(1);
    expect(graph.nodes.get(reads[0].to).meta.effectType).toBe('db_read');
  });

  it('captures the outbound webhook as an http_call effect', () => {
    const http = nodesOf(graph, 'effect').filter(
      (n) => n.meta.effectType === 'http_call',
    );
    expect(http).toHaveLength(1);
    expect(http[0].meta.target).toBe('https://hooks.example.com/user-created');
  });

  it('DeadPathElimination removes the uncalled helper', () => {
    const dpe = report.passes.find((p) => p.pass === 'DeadPathElimination');
    expect(dpe.details.map((d) => d.id)).toContainEqual(
      expect.stringContaining('#unusedHelper:'),
    );
    expect([...graph.nodes.keys()].some((id) => id.includes('unusedHelper'))).toBe(false);
  });

  it('DeadPathElimination keeps but reports the orphan table', () => {
    const dpe = report.passes.find((p) => p.pass === 'DeadPathElimination');
    expect(dpe.orphanState).toEqual(['state:sql:audit_log']);
    expect(graph.nodes.has('state:sql:audit_log')).toBe(true);
  });

  it('StateMinimization merges the linear middleware chain', () => {
    const sm = report.passes.find((p) => p.pass === 'StateMinimization');
    expect(sm.merged).toBe(1);
    const merged = nodesOf(graph, 'logic').find((n) => n.label.includes('»'));
    expect(merged.label).toBe('logRequest » tagRequest');
    expect([...graph.nodes.keys()].some((id) => id.includes('#tagRequest:'))).toBe(false);
  });

  it('TypePropagation resolves the final API return structures', () => {
    const get = graph.nodes.get('entrypoint:GET /users/:id');
    expect(get.meta.returns).toEqual({
      id: 'string', // from the :id path param
      email: 'string', // from users.email VARCHAR
      active: 'boolean', // from users.active BOOLEAN
    });
    const post = graph.nodes.get('entrypoint:POST /users');
    expect(post.meta.returns).toEqual({ ok: 'boolean' });
  });

  it('threads the request schema onto the entrypoint→handler data_flow', () => {
    const df = edgesOf(graph, 'data_flow').find(
      (e) => e.from === 'entrypoint:GET /users/:id' && e.meta.via === 'request',
    );
    expect(df.meta.schema).toEqual({ id: 'string' });
  });
});

describe('UBG: determinism & serialization', () => {
  it('two compiles of the same tree are byte-identical', () => {
    const a = compileUBG(EXPRESS_FIXTURE, { write: false });
    const b = compileUBG(EXPRESS_FIXTURE, { write: false });
    expect(a.json).toBe(b.json);
    expect(a.graph.meta.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes a valid versioned artifact where asked', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-ubg-'));
    try {
      const outFile = path.join(tmp, 'ubg.json');
      const { outPath } = compileUBG(EXPRESS_FIXTURE, { write: true, out: outFile });
      expect(outPath).toBe(outFile);
      const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      expect(parsed.version).toBe('sparda-ubg/v1');
      expect(parsed.nodes.length).toBeGreaterThan(0);
      // canonical order: nodes sorted by id
      const ids = parsed.nodes.map((n) => n.id);
      expect(ids).toEqual([...ids].sort());
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('optimization passes can be disabled', () => {
    const raw = compileUBG(EXPRESS_FIXTURE, { write: false, optimizePasses: false });
    expect(raw.report.passes).toEqual([]);
    expect([...raw.graph.nodes.keys()].some((id) => id.includes('unusedHelper'))).toBe(
      true,
    );
  });
});

describe('UBG: Next.js compilation', () => {
  it('compiles App Router handlers into entrypoints with return shapes', () => {
    const { graph, report } = compileUBG(NEXT_FIXTURE, { write: false });
    expect(report.framework).toBe('nextjs');
    const ids = nodesOf(graph, 'entrypoint').map((n) => n.id);
    expect(ids).toContain('entrypoint:GET /api/users');
    expect(ids).toContain('entrypoint:POST /api/users');
    const get = graph.nodes.get('entrypoint:GET /api/users');
    expect(get.meta.returns).toMatchObject({ users: 'array' });
  });
});

describe.skipIf(!hasPython)('UBG: FastAPI compilation', () => {
  const { graph, report } = compileUBG(FASTAPI_FIXTURE, { write: false });

  it('lowers Python into the same five node kinds', () => {
    expect(report.framework).toBe('fastapi');
    for (const kind of ['entrypoint', 'logic', 'state', 'effect', 'guard'])
      expect(nodesOf(graph, kind).length, kind).toBeGreaterThan(0);
  });

  it('compiles both routes with typed inputs', () => {
    const get = graph.nodes.get('entrypoint:GET /users/{user_id}');
    expect(get).toBeDefined();
    expect(get.meta.inputs).toContainEqual(
      expect.objectContaining({ name: 'user_id', in: 'path', type: 'integer' }),
    );
    expect(graph.nodes.get('entrypoint:POST /users')).toBeDefined();
  });

  it('classifies the Depends(require_auth) dependency as a gating guard', () => {
    const guard = nodesOf(graph, 'guard').find((n) => n.label === 'require_auth');
    expect(guard).toBeDefined();
    expect(guard.meta.guardType).toBe('denies-unauthorized');
    const gates = edgesOf(graph, 'gate').filter((e) => e.from === guard.id);
    expect(gates).toHaveLength(1);
    expect(graph.nodes.get(gates[0].to).label).toBe('create_user');
  });

  it('links the INSERT to the users state node as a mutation', () => {
    const mutations = edgesOf(graph, 'mutation');
    expect(mutations).toHaveLength(1);
    expect(mutations[0].to).toBe('state:sql:users');
    expect(mutations[0].meta.op).toBe('insert');
  });

  it('captures the outbound webhook as an http_call effect', () => {
    const http = nodesOf(graph, 'effect').filter(
      (n) => n.meta.effectType === 'http_call',
    );
    expect(http).toHaveLength(1);
    expect(http[0].meta.target).toBe('https://hooks.example.com/user-created');
  });

  it('eliminates the uncalled Python helper', () => {
    expect([...graph.nodes.keys()].some((id) => id.includes('unused_helper'))).toBe(
      false,
    );
  });

  it('TypePropagation resolves returns across the Python/SQL boundary', () => {
    const get = graph.nodes.get('entrypoint:GET /users/{user_id}');
    expect(get.meta.returns).toEqual({
      id: 'integer', // from the user_id: int annotation
      email: 'string', // from users.email VARCHAR
      active: 'boolean', // from users.active BOOLEAN
    });
    const post = graph.nodes.get('entrypoint:POST /users');
    expect(post.meta.returns).toEqual({ ok: 'boolean' });
  });

  it('is byte-deterministic like the JS lowerings', () => {
    const again = compileUBG(FASTAPI_FIXTURE, { write: false });
    expect(again.json).toBe(compileUBG(FASTAPI_FIXTURE, { write: false }).json);
  });
});

describe('UBG: schema invariants', () => {
  it('rejects dangling edges', () => {
    const g = createGraph();
    addNode(g, makeNode('logic:a#f:1', 'logic', 'f', null, {}));
    addEdge(g, makeEdge('control_flow', 'logic:a#f:1', 'logic:ghost#g:9', {}));
    expect(() => validateGraph(g)).toThrow(/dangling/);
  });

  it('rejects unknown kinds at construction', () => {
    expect(() => makeNode('x', 'wormhole', 'x')).toThrow(/unknown node kind/);
    expect(() => makeEdge('teleport', 'a', 'b')).toThrow(/unknown edge kind/);
  });

  it('canonicalization sorts nodes, edges and keys', () => {
    const g = createGraph({ z: 1, a: 2 });
    addNode(g, makeNode('logic:b#f:1', 'logic', 'b', null, { z: 1, a: 2 }));
    addNode(g, makeNode('logic:a#f:1', 'logic', 'a', null, {}));
    const c = canonicalizeGraph(g);
    expect(c.nodes.map((n) => n.id)).toEqual(['logic:a#f:1', 'logic:b#f:1']);
    expect(Object.keys(c.meta)).toEqual(['a', 'z']);
    expect(Object.keys(c.nodes[1].meta)).toEqual(['a', 'z']);
  });
});

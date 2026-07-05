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
      expect(parsed.version).toBe('sparda-ubg/v1.1');
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

describe('UBG: SBIR v1.1 semantics', () => {
  const SEMANTICS_FIXTURE = path.join(here, 'fixtures', 'ubg-semantics');
  const { graph } = compileUBG(SEMANTICS_FIXTURE, { write: false });
  const effectByTarget = (t) =>
    [...graph.nodes.values()].find((n) => n.kind === 'effect' && n.meta.target === t);

  it('extracts SQL invariants onto state nodes (§2.1)', () => {
    const users = graph.nodes.get('state:sql:users').meta.invariants;
    expect(users).toContainEqual({ type: 'primary_key', fields: ['id'] });
    expect(users).toContainEqual({ type: 'not_null', fields: ['email'] });
    expect(users).toContainEqual({ type: 'unique', fields: ['email'] });
    expect(users).toContainEqual({ type: 'check', expression: 'balance >= 0' });
    expect(users).toContainEqual({ type: 'default', fields: ['balance'], value: '0' });

    const orders = graph.nodes.get('state:sql:orders').meta.invariants;
    expect(orders).toContainEqual({
      type: 'foreign_key',
      fields: ['user_id'],
      references: { table: 'users', fields: ['id'] },
    });
    expect(orders).toContainEqual({ type: 'check', expression: 'amount >= 0' });
  });

  it('derives ownership edges and consistency domains from FKs (§2.3)', () => {
    const ownership = edgesOf(graph, 'ownership').map((e) => `${e.from}>${e.to}`);
    expect(ownership).toContain('state:sql:users>state:sql:orders');
    expect(ownership).toContain('state:sql:orders>state:sql:order_items');

    expect(graph.nodes.get('state:sql:users').meta).toMatchObject({
      consistencyDomain: 'Users',
      role: 'aggregate_root',
    });
    expect(graph.nodes.get('state:sql:orders').meta).toMatchObject({
      consistencyDomain: 'Users',
      role: 'member',
    });
    expect(graph.nodes.get('state:sql:order_items').meta).toMatchObject({
      consistencyDomain: 'Users',
      role: 'member',
    });
    expect(graph.nodes.get('state:sql:logs').meta).toMatchObject({
      consistencyDomain: 'Logs',
      role: 'standalone',
    });
  });

  it('computes each entrypoint blast radius (§2.3 mutatesDomains)', () => {
    expect(graph.nodes.get('entrypoint:POST /orders').meta.mutatesDomains).toEqual([
      'Users',
    ]);
    expect(graph.nodes.get('entrypoint:GET /status').meta.mutatesDomains).toBeUndefined();
  });

  it('scopes transactional effects and marks rollback (§2.2)', () => {
    const txEffects = [...graph.nodes.values()].filter(
      (n) => n.kind === 'effect' && n.meta.transaction,
    );
    expect(txEffects).toHaveLength(2);
    const ids = new Set(txEffects.map((n) => n.meta.transaction.id));
    expect(ids.size).toBe(1); // both statements live in the same scope
    expect([...ids][0]).toMatch(/^tx:src\/app\.js:\d+$/);

    const update = txEffects.find((n) => n.meta.op === 'update');
    expect(update.meta).toMatchObject({
      idempotent: true,
      compensable: true,
      observable: false,
      onFailure: { action: 'rollback' },
    });
    const insert = txEffects.find((n) => n.meta.op === 'insert');
    expect(insert.meta).toMatchObject({ idempotent: false, compensable: true });
  });

  it('emits compensation edges from catch-effects to try-effects (§2.2)', () => {
    const refund = effectByTarget('https://api.stripe.example/refund');
    const charge = effectByTarget('https://api.stripe.example/charge');
    const comp = edgesOf(graph, 'compensation');
    expect(comp).toHaveLength(2); // refund undoes the charge AND the insert
    expect(comp.every((e) => e.from === refund.id)).toBe(true);
    expect(charge.meta.onFailure).toEqual({ action: 'compensate', by: [refund.id] });

    expect(charge.meta).toMatchObject({
      httpMethod: 'POST',
      observable: true,
      idempotent: false,
      compensable: true, // the refund exists
    });
    expect(refund.meta).toMatchObject({ observable: true, compensable: false });
  });

  it('classifies the safe GET probe (§2.4)', () => {
    expect(effectByTarget('https://status.example.com/ping').meta).toMatchObject({
      httpMethod: 'GET',
      idempotent: true,
      observable: false,
      compensable: true,
    });
  });

  it('flags validated entrypoints without decomposing the validator (§2.1)', () => {
    expect(graph.nodes.get('entrypoint:POST /users').meta.inputValidated).toBe(true);
    expect(graph.nodes.get('entrypoint:POST /pay').meta.inputValidated).toBeUndefined();
  });

  it('stays byte-deterministic with the v1.1 passes (Law 3)', () => {
    const a = compileUBG(SEMANTICS_FIXTURE, { write: false });
    const b = compileUBG(SEMANTICS_FIXTURE, { write: false });
    expect(a.json).toBe(b.json);
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

  it('scopes the `with db:` insert as a transaction (SBIR §2.2, DB-API idiom)', () => {
    const insert = [...graph.nodes.values()].find(
      (n) => n.kind === 'effect' && n.meta.op === 'insert',
    );
    expect(insert.meta.transaction?.id).toMatch(/^tx:main\.py:\d+$/);
    expect(insert.meta).toMatchObject({
      compensable: true,
      onFailure: { action: 'rollback' },
    });
  });

  it('classifies the Python webhook POST as observable (SBIR §2.4)', () => {
    const http = [...graph.nodes.values()].find(
      (n) => n.kind === 'effect' && n.meta.effectType === 'http_call',
    );
    expect(http.meta).toMatchObject({
      httpMethod: 'POST',
      observable: true,
      idempotent: false,
      compensable: false,
    });
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

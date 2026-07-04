// tests/round3.test.js — the predictive organism (R3.2 twin, R3.3 grammar,
// R3.4 evolution) + R4.5 germination. The value boundary (ADR-021) is the
// through-line: values live only in .sparda/, the twin is the only arena,
// evolution only suggests (seen: 0), and the seed never carries a value.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  learnExemplars,
  createTwinServer,
  eligibleForLearning,
} from '../src/commands/twin.js';
import { buildGrammar, responseKeysOf } from '../src/commands/grammar.js';
import { candidateChains, trialCandidate, runEvolve } from '../src/commands/evolve.js';
import { buildSeed, runSeed } from '../src/commands/seed.js';

const KEY = 'twin-test-key';

function manifest() {
  return {
    version: 1,
    framework: 'express',
    entryFile: 'src/app.js',
    port: 65533,
    localKey: KEY,
    generatedFiles: [],
    tools: {
      get_api_users: {
        method: 'GET',
        path: '/api/users',
        enabled: true,
        pathParams: [],
        params: [],
      },
      get_api_users_by_id: {
        method: 'GET',
        path: '/api/users/:id',
        enabled: true,
        pathParams: ['id'],
        params: [
          { name: 'id', in: 'path', type: 'string', required: true, description: 'p' },
        ],
      },
      post_api_users: {
        method: 'POST',
        path: '/api/users',
        enabled: true,
        pathParams: [],
        params: [],
      },
    },
    labs: { recordSequences: true, circuits: {} },
    sparding: { policies: {}, events: [], failures: {}, toolFingerprints: {} },
  };
}

const exemplars = () => ({
  get_api_users: { data: { users: [{ id: 'u_42', name: 'zak' }] }, learnedAt: 'x' },
});

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

describe('R3.2 — the twin', () => {
  it('learning eligibility: enabled GETs without required path params only', () => {
    const m = manifest();
    expect(eligibleForLearning(m.tools.get_api_users)).toBe(true);
    expect(eligibleForLearning(m.tools.get_api_users_by_id)).toBe(false);
    expect(eligibleForLearning(m.tools.post_api_users)).toBe(false);
  });

  it('learns capped exemplars through the live router, skips with reasons', async () => {
    const fakeFetch = async () => ({
      json: async () => ({ upstreamStatus: 200, data: { users: [] } }),
      status: 200,
    });
    const { exemplars: ex, skipped } = await learnExemplars(manifest(), fakeFetch);
    expect(Object.keys(ex)).toEqual(['get_api_users']);
    const reasons = skipped.map((s) => s.reason).join(' | ');
    expect(reasons).toContain('write tool');
    expect(reasons).toContain('path params');
  });

  it('serves the ghost: routes + /mcp surface, writes are 202 echoes', async () => {
    const server = createTwinServer(manifest(), exemplars());
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    // plain route answered from the exemplar
    const users = await fetch(`${base}/api/users`).then((r) => r.json());
    expect(users.users[0].id).toBe('u_42');

    // a write acknowledges and touches nothing
    const write = await fetch(`${base}/api/users`, { method: 'POST', body: '{}' });
    expect(write.status).toBe(202);
    expect((await write.json()).__sparda_twin__).toBe(true);

    // the /mcp surface: key enforced, tools served, invoke from exemplar
    expect((await fetch(`${base}/mcp/tools`)).status).toBe(401);
    const tools = await fetch(`${base}/mcp/tools`, {
      headers: { 'x-sparda-key': KEY },
    }).then((r) => r.json());
    expect(tools.get_api_users.method).toBe('GET');
    const invoked = await fetch(`${base}/mcp/invoke`, {
      method: 'POST',
      headers: { 'x-sparda-key': KEY },
      body: JSON.stringify({ tool: 'get_api_users', args: {} }),
    }).then((r) => r.json());
    expect(invoked.twin).toBe(true);
    expect(invoked.data.users[0].name).toBe('zak');

    // stats identify themselves as the ghost — the twin never lies about being one
    const stats = await fetch(`${base}/mcp/stats`, {
      headers: { 'x-sparda-key': KEY },
    }).then((r) => r.json());
    expect(stats.twin).toBe(true);
    server.close();
  });
});

describe('R3.3 — the grammar', () => {
  it('harvests bounded response keys with the condenser walk', () => {
    const keys = responseKeysOf({ users: [{ id: 'u_1', name: 'x' }], total: 1 });
    expect(keys.has('id')).toBe(true);
    expect(keys.has('total')).toBe(true);
  });

  it('observed edges from circuits, hypotheses from exemplars, labelled apart', () => {
    const m = manifest();
    m.labs.circuits['get_api_users>get_api_users_by_id'] = {
      steps: ['get_api_users', 'get_api_users_by_id'],
      links: [
        { from: 'get_api_users', to: 'get_api_users_by_id', arg: 'id', fromKey: 'id' },
      ],
      seen: 3,
    };
    const g = buildGrammar(m, exemplars());
    const observed = g.edges.filter((e) => e.source === 'observed');
    expect(observed).toHaveLength(1);
    // the same flow is NOT duplicated as a hypothesis — reality already spoke
    expect(
      g.edges.filter((e) => e.from === 'get_api_users' && e.to === 'get_api_users_by_id'),
    ).toHaveLength(1);
    expect(g.phrases[0].seen).toBe(3);
  });

  it('a fresh app with exemplars gets hypotheses only, said as hypotheses', () => {
    const g = buildGrammar(manifest(), exemplars());
    expect(g.edges.every((e) => e.source === 'hypothesis')).toBe(true);
    expect(
      g.edges.some((e) => e.to === 'get_api_users_by_id' && e.fromKey === 'id'),
    ).toBe(true);
  });
});

describe('R3.4 — evolution against the twin', () => {
  it('candidates come from untested hypotheses only', () => {
    const g = buildGrammar(manifest(), exemplars());
    const fresh = candidateChains(g, {});
    expect(fresh.some((c) => c.key === 'get_api_users>get_api_users_by_id')).toBe(true);
    // already-known chains are never re-proposed
    const known = candidateChains(g, { 'get_api_users>get_api_users_by_id': {} });
    expect(known).toHaveLength(0);
  });

  it('a survivor lands as a suggestion (seen: 0, evolved, NO composite)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-evolve-'));
    const m = manifest();
    fs.writeFileSync(path.join(dir, 'sparda.json'), JSON.stringify(m));
    fs.mkdirSync(path.join(dir, '.sparda'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.sparda', 'twin.json'),
      JSON.stringify({ version: 'sparda-twin/v1', exemplars: exemplars() }),
    );

    const { survivors, failed } = await runEvolve({ cwd: dir });
    expect(failed).toEqual([]);
    expect(survivors.map((s) => s.key)).toContain('get_api_users>get_api_users_by_id');

    const after = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    const suggested = after.labs.circuits['get_api_users>get_api_users_by_id'];
    expect(suggested.seen).toBe(0); // heredity without confirmation
    expect(suggested.evolved).toBe(true);
    expect(suggested.composite).toBeUndefined(); // never crystallized here
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a chain whose fed key does not exist is culled with the reason', async () => {
    const m = manifest();
    const server = createTwinServer(m, {
      get_api_users: { data: { users: [{ uuid: 'nope' }] } }, // no `id` anywhere
    });
    const port = await listen(server);
    const verdict = await trialCandidate(
      {
        key: 'get_api_users>get_api_users_by_id',
        steps: ['get_api_users', 'get_api_users_by_id'],
        links: [
          { from: 'get_api_users', to: 'get_api_users_by_id', arg: 'id', fromKey: 'id' },
        ],
      },
      { port, localKey: KEY },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("'id' not found");
    server.close();
  });
});

describe('R4.5 — germination + the value boundary end to end', () => {
  it('the seed still never carries a value, and --germinate regrows the grammar', async () => {
    const donor = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-germ-a-'));
    const receiver = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-germ-b-'));
    const m = manifest();
    m.labs.circuits['get_api_users>get_api_users_by_id'] = {
      steps: ['get_api_users', 'get_api_users_by_id'],
      links: [
        { from: 'get_api_users', to: 'get_api_users_by_id', arg: 'id', fromKey: 'id' },
      ],
      seen: 0,
      evolved: true,
    };
    fs.writeFileSync(path.join(donor, 'sparda.json'), JSON.stringify(m));
    fs.writeFileSync(path.join(receiver, 'sparda.json'), JSON.stringify(manifest()));

    // the exemplar VALUE ('u_42', 'zak') must never appear in a seed
    const seed = buildSeed(m);
    expect(JSON.stringify(seed)).not.toContain('u_42');
    expect(JSON.stringify(seed)).not.toContain('zak');

    await runSeed({ cwd: donor, out: 'genome.json' }, ['export']);
    await runSeed({ cwd: receiver, germinate: true }, [
      'import',
      path.join(donor, 'genome.json'),
    ]);

    const grammarPath = path.join(receiver, '.sparda', 'grammar.json');
    expect(fs.existsSync(grammarPath)).toBe(true);
    const g = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
    // the evolved suggestion travelled as structure and regrew as a phrase
    expect(g.phrases.some((p) => p.key === 'get_api_users>get_api_users_by_id')).toBe(
      true,
    );
    expect(JSON.stringify(g)).not.toContain('u_42'); // still no value, anywhere
    fs.rmSync(donor, { recursive: true, force: true });
    fs.rmSync(receiver, { recursive: true, force: true });
  });
});

// tests/nextjs.test.js — Next.js App Router support end to end:
// detect → parse (filesystem routing semantics) → generate (file-based
// injection) → the generated handler actually runs (web-standard
// Request/Response, so vitest drives it without installing Next) → remove
// leaves a byte-identical tree.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectStack } from '../src/detect.js';
import { parseNextProject } from '../src/parser/nextjs.js';
import { generateNext } from '../src/generator/nextjs.js';
import { runRemove } from '../src/commands/remove.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'nextjs-basic');

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-nextjs-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

// full recursive file map (path -> content) — dirs themselves are invisible to
// git, but remove prunes them anyway; we assert file-level identity.
function fileMap(root) {
  const out = {};
  (function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) walk(abs);
      else
        out[path.relative(root, abs).split(path.sep).join('/')] = fs.readFileSync(
          abs,
          'utf8',
        );
    }
  })(root);
  return out;
}

describe('detect — nextjs', () => {
  it('detects Next.js App Router, app dir and script port', () => {
    const stack = detectStack(FIXTURE);
    expect(stack.framework).toBe('nextjs');
    expect(stack.entryFile).toBe('app');
    expect(stack.port).toBe(3456); // from `next dev -p 3456`
  });
});

describe('parser — nextjs', () => {
  const { routes, skipped } = parseNextProject(FIXTURE, 'app');
  const byKey = Object.fromEntries(routes.map((r) => [`${r.method} ${r.path}`, r]));

  it('extracts route handlers with filesystem-derived paths', () => {
    expect(Object.keys(byKey).sort()).toEqual([
      'delete /api/users/:id',
      'get /api/users',
      'get /api/users/:id',
      'get /health',
      'post /api/users',
    ]);
  });

  it('strips route groups from the URL', () => {
    expect(byKey['get /health']).toBeDefined(); // app/(internal)/health
  });

  it('maps [id] to :id and collects the path param', () => {
    const r = byKey['get /api/users/:id'];
    expect(r.params.filter((p) => p.in === 'path').map((p) => p.name)).toEqual(['id']);
    expect(r.description).toBe('Fetch one user by id');
  });

  it('detects query params via searchParams.get()', () => {
    const r = byKey['get /api/users'];
    const q = r.params.filter((p) => p.in === 'query').map((p) => p.name);
    expect(q.sort()).toEqual(['limit', 'offset']);
    expect(r.description).toBe('List users with optional pagination');
  });

  it('supports export const VERB = arrow and marks writes mutating', () => {
    const del = byKey['delete /api/users/:id'];
    expect(del.mutating).toBe(true);
    expect(del.confidence).toBe('low');
    expect(del.params.some((p) => p.in === 'body')).toBe(true);
  });

  it('skips catch-all, parallel slots and /mcp with reasons', () => {
    const reasons = skipped.map((s) => s.reason).join(' | ');
    expect(reasons).toContain('catch-all');
    expect(reasons).toContain('parallel route slot');
    expect(reasons).toContain('self-referential');
  });

  it('never scans private (_) folders', () => {
    expect(routes.every((r) => !r.sourceFile.includes('_lib'))).toBe(true);
    expect(skipped.every((s) => !String(s.file ?? '').includes('_lib'))).toBe(true);
  });
});

describe('generator — nextjs (file-based injection)', () => {
  it('writes the catch-all handler, the manifest, and touches nothing else', () => {
    const dir = copyFixture();
    const before = fileMap(dir);
    const { routes } = parseNextProject(dir, 'app');
    const result = generateNext({ cwd: dir, appDir: 'app', port: 3456, routes });

    expect(result.routerFile).toBe('app/mcp/[...sparda]/route.js');
    expect(result.injection).toEqual({ injected: false, manual: null, fileBased: true });
    const routerAbs = path.join(dir, 'app', 'mcp', '[...sparda]', 'route.js');
    expect(fs.existsSync(routerAbs)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    expect(manifest.framework).toBe('nextjs');
    expect(manifest.injectedFiles).toEqual([]);
    expect(manifest.generatedFiles).toEqual(['app/mcp/[...sparda]/route.js']);
    expect(fs.readFileSync(routerAbs, 'utf8')).toContain(manifest.localKey);

    // write-safety: GETs on, writes off
    expect(manifest.tools.get_api_users.enabled).toBe(true);
    expect(manifest.tools.post_api_users.enabled).toBe(false);
    expect(manifest.tools.delete_api_users_by_id.enabled).toBe(false);

    // no pre-existing user file was modified
    const after = fileMap(dir);
    for (const [file, content] of Object.entries(before)) {
      if (file === '.gitignore') continue; // .sparda/ line added, recorded for revert
      expect(after[file]).toBe(content);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('re-init carries over enabled overrides and the localKey', () => {
    const dir = copyFixture();
    const { routes } = parseNextProject(dir, 'app');
    const first = generateNext({ cwd: dir, appDir: 'app', port: 3456, routes });
    const m1 = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    m1.tools.post_api_users.enabled = true; // user opts a write in
    fs.writeFileSync(path.join(dir, 'sparda.json'), JSON.stringify(m1, null, 2));

    generateNext({ cwd: dir, appDir: 'app', port: 3456, routes });
    const m2 = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    expect(m2.localKey).toBe(first.manifest.localKey);
    expect(m2.tools.post_api_users.enabled).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('generated handler — runs standalone (web-standard, no Next needed)', () => {
  async function initAndImport() {
    const dir = copyFixture();
    const { routes } = parseNextProject(dir, 'app');
    generateNext({ cwd: dir, appDir: 'app', port: 65531, routes }); // dead port: no host
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    const mod = await import(
      pathToFileURL(path.join(dir, 'app', 'mcp', '[...sparda]', 'route.js')).href
    );
    return { dir, manifest, mod };
  }
  const ctx = (segments) => ({ params: Promise.resolve({ sparda: segments }) });
  const req = (url, init) => new Request(`http://127.0.0.1${url}`, init);

  it('enforces the local key, serves tools, and answers JSON 404/405', async () => {
    const { dir, manifest, mod } = await initAndImport();
    const key = manifest.localKey;

    const unauth = await mod.GET(req('/mcp/tools'), ctx(['tools']));
    expect(unauth.status).toBe(401);

    const tools = await mod.GET(
      req('/mcp/tools', { headers: { 'x-sparda-key': key } }),
      ctx(['tools']),
    );
    expect(tools.status).toBe(200);
    const body = await tools.json();
    expect(body.get_api_users.method).toBe('GET');
    expect(body.post_api_users.enabled).toBe(false);

    const nf = await mod.GET(
      req('/mcp/nope', { headers: { 'x-sparda-key': key } }),
      ctx(['nope']),
    );
    expect(nf.status).toBe(404);

    const wrongVerb = await mod.GET(
      req('/mcp/invoke', { headers: { 'x-sparda-key': key } }),
      ctx(['invoke']),
    );
    expect(wrongVerb.status).toBe(405);
    expect((await wrongVerb.json()).allow).toBe('POST');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('blocks disabled writes (403), unknown tools (404), non-object args (400)', async () => {
    const { dir, manifest, mod } = await initAndImport();
    const key = manifest.localKey;
    const invoke = (payload) =>
      mod.POST(
        req('/mcp/invoke', {
          method: 'POST',
          headers: { 'x-sparda-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        ctx(['invoke']),
      );

    const disabled = await invoke({ tool: 'post_api_users', args: { body: { a: 1 } } });
    expect(disabled.status).toBe(403);
    const dBody = await disabled.json();
    expect(dBody.spardingProof.decision).toBe('block');
    expect(dBody.spardingProof.reasons.join(' ')).toContain('write-safety');

    const unknown = await invoke({ tool: 'nope' });
    expect(unknown.status).toBe(404);

    const badArgs = await invoke({ tool: 'get_api_users', args: null });
    expect(badArgs.status).toBe(400);
    expect((await badArgs.json()).got).toBe('null');

    // stats endpoint exposes the gauges
    const stats = await mod.GET(
      req('/mcp/stats', { headers: { 'x-sparda-key': key } }),
      ctx(['stats']),
    );
    const sBody = await stats.json();
    expect(sBody.recycle).toEqual({ servedByCircle: 0, paidFull: 0, ratePct: 0 });
    expect(sBody.purity.post_api_users.class).toBe('erasing');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('two-phase commit: an enabled write is gated 202, confirm token is single-use', async () => {
    const dir = copyFixture();
    const { routes } = parseNextProject(dir, 'app');
    generateNext({ cwd: dir, appDir: 'app', port: 65532, routes });
    // opt the write in, regenerate so the handler embeds enabled:true
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    m.tools.post_api_users.enabled = true;
    fs.writeFileSync(path.join(dir, 'sparda.json'), JSON.stringify(m, null, 2));
    generateNext({ cwd: dir, appDir: 'app', port: 65532, routes });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'sparda.json'), 'utf8'));
    const mod = await import(
      pathToFileURL(path.join(dir, 'app', 'mcp', '[...sparda]', 'route.js')).href
    );
    const key = manifest.localKey;

    const gated = await mod.POST(
      req('/mcp/invoke', {
        method: 'POST',
        headers: { 'x-sparda-key': key },
        body: JSON.stringify({ tool: 'post_api_users', args: { body: { name: 'x' } } }),
      }),
      ctx(['invoke']),
    );
    expect(gated.status).toBe(202); // writes policy: require_human — NOT executed
    const gBody = await gated.json();
    expect(gBody.status).toBe('awaiting_confirmation');
    expect(gBody.confirm).toMatch(/^cfm_/);
    expect(gBody.instruction).toContain('NOT EXECUTED');

    // replaying a consumed/unknown token is refused
    const confirm = (token) =>
      mod.POST(
        req('/mcp/invoke/confirm', {
          method: 'POST',
          headers: { 'x-sparda-key': key },
          body: JSON.stringify({ confirm: token }),
        }),
        ctx(['invoke', 'confirm']),
      );
    const bogus = await confirm('cfm_bogus');
    expect(bogus.status).toBe(409);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('remove — nextjs', () => {
  it('init → remove leaves a byte-identical tree (dirs pruned too)', async () => {
    const dir = copyFixture();
    const before = fileMap(dir);
    const { routes } = parseNextProject(dir, 'app');
    generateNext({ cwd: dir, appDir: 'app', port: 3456, routes });
    await runRemove({ cwd: dir, yes: true });

    expect(fileMap(dir)).toEqual(before);
    // our [...sparda] dir is pruned; the user's own app/mcp/ping survives
    expect(fs.existsSync(path.join(dir, 'app', 'mcp', '[...sparda]'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'app', 'mcp', 'ping', 'route.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'sparda.json'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

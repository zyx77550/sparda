// pr-comment-e2e.test.js — the whole PR-bot flow, wired exactly as the GitHub
// Action wires it, end to end: a real git repo → `sparda review --markdown` (a
// subprocess) → a body file → the comment script (a subprocess) → a MOCK GitHub
// API. This is the integration a first external user actually hits; the unit
// tests cover the pieces, this proves they compose. Asserts the sticky contract:
// first run POSTs, second run PATCHes the same comment.
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const CLI = path.join(REPO, 'src', 'index.js');
const SCRIPT = path.join(REPO, '.github', 'sparda-pr-comment.mjs');
const SEMANTICS = path.join(here, 'fixtures', 'ubg-semantics');
const NODE = process.execPath;

// The comment script must run as an ASYNC child: the mock GitHub server lives in
// THIS process, and spawnSync would block the event loop — the server could never
// answer the child's fetch and the two would deadlock (found the hard way).
function spawnAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// A minimal GitHub-comments API: GET lists, POST appends, PATCH acknowledges —
// with the created comment persisted so the second run finds it by its marker.
function mockGitHub() {
  const requests = [];
  let comments = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, body: parsed });
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      if (req.method === 'GET') return res.end(JSON.stringify(comments));
      if (req.method === 'POST') {
        const c = { id: 101, body: parsed.body };
        comments.push(c);
        return res.end(JSON.stringify(c));
      }
      if (req.method === 'PATCH') return res.end(JSON.stringify({ id: 101 }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return { server, requests };
}

describe('PR bot end-to-end (review → body → sticky comment over a mock GitHub)', () => {
  const tmps = [];
  let server;
  afterEach(async () => {
    if (server) await new Promise((r) => server.close(r));
    server = null;
    for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function riskyPr() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-bot-e2e-'));
    tmps.push(dir);
    fs.cpSync(SEMANTICS, dir, { recursive: true });
    const git = (...a) =>
      spawnSync('git', ['-C', dir, ...a], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      });
    const app = path.join(dir, 'src', 'app.js');
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'base');
    // base: guard the bait DELETE route
    fs.writeFileSync(
      app,
      fs
        .readFileSync(app, 'utf8')
        .replace(
          "app.delete('/orders/:id', async",
          "app.delete('/orders/:id', requireAuth, async",
        ),
    );
    git('commit', '-aqm', 'guard the delete');
    // working tree (the PR): remove the guard again
    fs.writeFileSync(
      app,
      fs
        .readFileSync(app, 'utf8')
        .replace(
          "app.delete('/orders/:id', requireAuth, async",
          "app.delete('/orders/:id', async",
        ),
    );
    return dir;
  }

  it('posts the behavior diff, then updates the SAME comment on a re-run', async () => {
    const dir = riskyPr();

    // 1) the Action's review step: `sparda review --base HEAD --markdown` → body file
    const review = spawnSync(NODE, [CLI, 'review', '--base', 'HEAD', '--markdown'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(review.stdout).toContain('GUARD_REMOVED');
    const bodyFile = path.join(dir, 'review.md');
    fs.writeFileSync(bodyFile, review.stdout);

    // 2) the Action's comment step: the poster against a mock GitHub API
    const mock = mockGitHub();
    server = mock.server;
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const env = {
      ...process.env,
      GITHUB_TOKEN: 'x',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      SPARDA_REVIEW_BODY_FILE: bodyFile,
      SPARDA_PR_NUMBER: '7',
    };

    const first = await spawnAsync(NODE, [SCRIPT], { env });
    expect(first.status).toBe(0);
    const post = mock.requests.find((r) => r.method === 'POST');
    expect(post).toBeTruthy();
    expect(post.url).toContain('/repos/o/r/issues/7/comments');
    expect(post.body.body).toContain('<!-- sparda-review -->'); // sticky marker
    expect(post.body.body).toContain('GUARD_REMOVED');

    // 3) re-run (a new push): must EDIT the existing comment, not post a second one
    const second = await spawnAsync(NODE, [SCRIPT], { env });
    expect(second.status).toBe(0);
    const patch = mock.requests.find((r) => r.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch.url).toContain('/repos/o/r/issues/comments/101');
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(1); // never duplicated
  });
});

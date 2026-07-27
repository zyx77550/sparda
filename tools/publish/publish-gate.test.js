// tools/publish/publish-gate.test.js — the HQ→public valve's leak-proofing (ADR-016).
// Lives BESIDE the valve under private tools/ — never under tests/ — so its own
// secret-shaped fixtures (keys, the maintainer path/email) can never ride the
// `tests/**` allowlist into the public repo. The valve never publishes itself,
// and neither does the valve's test.
// Pure unit tests over the secret-gate + allowlist resolution. No git, no network,
// no publish — just proof that (1) real secret VALUES and private MARKERS are
// caught, (2) clean content passes, (3) documented exceptions are honored, and
// (4) the allowlist is default-deny: HQ-only files (strategy, sessions, and the
// valve itself) never land in the public set, while the open-core paths do.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scanForSecrets } from './secret-gate.mjs';
import { globToRegExp, partition } from './publish-public.mjs';
import {
  collectRelativeImports,
  resolveWithinSet,
  checkSelfContained,
} from './self-contained.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const allowlist = JSON.parse(fs.readFileSync(path.join(HERE, 'allowlist.json'), 'utf8'));
const patterns = allowlist.public.map(globToRegExp);

describe('secret-gate — hard secrets always block', () => {
  const cases = [
    ['anthropic key', 'const k = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA";'],
    ['private key block', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['aws access key', 'AWS_KEY=AKIAIOSFODNN7EXAMPLE'],
    ['github token', 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
    ['credentialed url', 'DATABASE_URL=postgres://user:s3cret@db.host:5432/app'],
    ['maintainer path', 'log written to C:\\Users\\zakwi\\app\\out.txt'],
    ['maintainer email', 'reach me at zakariagharzouli77@gmail.com'],
  ];
  for (const [name, text] of cases) {
    it(`flags ${name}`, () => {
      const r = scanForSecrets([{ path: 'f', text }]);
      expect(r.hardHits.length).toBeGreaterThan(0);
      expect(r.blocked).toBe(true);
    });
  }
});

describe('secret-gate — private markers need review (also block)', () => {
  const cases = [
    ['sandbox', "import { BlocC } from '../sparda-sandbox/sparda.ts';"],
    ['agent name', '// follow-up for Gemini before the next push'],
    ['paid tier', 'the mycélium mesh gossips manifests between nodes'],
    ['process doc', 'see ROADMAP.md round 3 for the plan'],
    ['valve ref', 'run node tools/publish/publish-public.mjs to publish'],
  ];
  for (const [name, text] of cases) {
    it(`flags ${name}`, () => {
      const r = scanForSecrets([{ path: 'f', text }]);
      expect(r.reviewHits.length).toBeGreaterThan(0);
      expect(r.blocked).toBe(true);
    });
  }
});

describe('secret-gate — clean content + exceptions', () => {
  it('passes clean open-core content', () => {
    const r = scanForSecrets([
      { path: 'src/index.js', text: 'export function detect() { return "express"; }' },
      { path: 'README', text: 'SPARDA turns any codebase into an MCP server.' },
    ]);
    expect(r.blocked).toBe(false);
    expect(r.hardHits).toEqual([]);
    expect(r.reviewHits).toEqual([]);
  });

  it('honors a documented exception for an intentional public string', () => {
    const text = 'Compatible with Google Gemini and Claude as MCP clients.';
    expect(scanForSecrets([{ path: 'f', text }]).blocked).toBe(true); // flagged by default
    const r = scanForSecrets(
      [{ path: 'f', text }],
      [{ allow: 'Google Gemini', why: 'docs name LLM vendors' }],
    );
    expect(r.blocked).toBe(false); // excepted line skipped
  });

  it('never echoes the matched secret value (only path/line/id/note)', () => {
    const r = scanForSecrets([
      { path: 'f', text: 'k=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA' },
    ]);
    expect(Object.keys(r.hardHits[0]).sort()).toEqual(['id', 'line', 'note', 'path']);
  });
});

describe('allowlist — default-deny partition', () => {
  it('opens the core, keeps strategy/process/the valve private', () => {
    const sample = [
      // open core → PUBLIC
      'src/index.js',
      'src/server/engine.js',
      'templates/express-router.txt',
      'tests/engine.test.js',
      'docs/ARCHITECTURE.md',
      'docs/SECURITY.md',
      'docs/TESTING.md',
      'docs/ERRORS.md',
      'package.json',
      '.github/workflows/ci.yml',
      '.gitignore',
      'LICENSE',
      // moat / process / internal → PRIVATE
      'ROADMAP.md',
      'CLAUDE.md',
      'CHANGELOG.md',
      'README.md',
      'docs/COMPETITION.md',
      'docs/DECISIONS.md',
      'docs/HANDOFF.md',
      'docs/README.md',
      'docs/EXPLAINER.md',
      'docs/sessions/2026-06-14-persistence-chantier1.md',
      'tools/publish/allowlist.json',
      'tools/publish/secret-gate.mjs',
    ];
    const { pub, priv } = partition(sample, patterns);

    for (const f of [
      'src/index.js',
      'src/server/engine.js',
      'templates/express-router.txt',
      'tests/engine.test.js',
      'docs/ARCHITECTURE.md',
      'docs/SECURITY.md',
      'package.json',
      '.github/workflows/ci.yml',
      'LICENSE',
    ]) {
      expect(pub).toContain(f);
    }
    for (const f of [
      'ROADMAP.md',
      'CLAUDE.md',
      'README.md',
      'docs/COMPETITION.md',
      'docs/DECISIONS.md',
      'docs/HANDOFF.md',
      'docs/sessions/2026-06-14-persistence-chantier1.md',
      'tools/publish/allowlist.json',
      'tools/publish/secret-gate.mjs',
    ]) {
      expect(priv).toContain(f);
    }
    // the valve never publishes itself, and the moat docs never cross over
    expect(pub).not.toContain('tools/publish/secret-gate.mjs');
    expect(pub).not.toContain('docs/COMPETITION.md');
    expect(pub).not.toContain('docs/DECISIONS.md');
  });

  it('a brand-new unlisted file is private by default (the whole point)', () => {
    const { pub, priv } = partition(
      ['docs/SECRET-NEW-STRATEGY.md', 'src/new-organ.js'],
      patterns,
    );
    expect(priv).toContain('docs/SECRET-NEW-STRATEGY.md'); // never listed → never leaks
    expect(pub).toContain('src/new-organ.js'); // src/** is opted in
  });
});

describe('self-containment — no published module imports a file left behind', () => {
  it('collectRelativeImports finds static/dynamic/re-export/require, ignores bare + comments', () => {
    const code = `
      import { a } from './a.js';
      import pkg from 'some-package';           // bare → not ours
      export { b } from '../lib/b.js';
      const c = await import('./c.js');
      const d = require('./d.js');
      // export { GET } from './impl'           <- a comment, NOT an import
    `;
    const specs = collectRelativeImports(code).sort();
    expect(specs).toEqual(['../lib/b.js', './a.js', './c.js', './d.js']);
    expect(specs).not.toContain('some-package');
    expect(specs).not.toContain('./impl'); // the comment must not count
  });

  it('resolveWithinSet mirrors Node tolerance (exact, +.js, /index.js)', () => {
    const set = new Set(['src/a/x.js', 'src/a/dir/index.js', 'src/a/y.js']);
    expect(resolveWithinSet('src/a/z.js', './x.js', set)).toBe('src/a/x.js');
    expect(resolveWithinSet('src/a/z.js', './x', set)).toBe('src/a/x.js'); // missing ext
    expect(resolveWithinSet('src/a/z.js', './dir', set)).toBe('src/a/dir/index.js'); // dir
    expect(resolveWithinSet('src/a/z.js', './missing.js', set)).toBeNull();
  });

  it('flags a src module importing a file outside the published set (the under-send)', () => {
    // src/commands/apocalypse.js imports ../ubg/apocalypse.js — omit it from the set
    const files = ['src/commands/apocalypse.js', 'src/ubg/compile.js'];
    const texts = {
      'src/commands/apocalypse.js': "import { checkGraph } from '../ubg/apocalypse.js';",
      'src/ubg/compile.js': 'export const compile = () => {};',
    };
    const v = checkSelfContained(files, (f) => texts[f]);
    expect(v).toEqual([
      { file: 'src/commands/apocalypse.js', specifier: '../ubg/apocalypse.js' },
    ]);
  });

  it('passes when the imported file is also published', () => {
    const files = ['src/commands/apocalypse.js', 'src/ubg/apocalypse.js'];
    const texts = {
      'src/commands/apocalypse.js': "import { checkGraph } from '../ubg/apocalypse.js';",
      'src/ubg/apocalypse.js': 'export const checkGraph = () => {};',
    };
    expect(checkSelfContained(files, (f) => texts[f])).toEqual([]);
  });

  // The real non-regression guard (ADR-016): run the rule over the ACTUAL set the
  // valve would push — git-tracked files matched by the allowlist. This is the
  // check that would have caught `../ubg/apocalypse.js` missing from the public
  // mirror in < 1s, and fails the instant any runtime import leaves the surface.
  it('the actual published set is closed under its own relative imports', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const { pub } = partition(tracked, patterns);
    const dangling = checkSelfContained(pub, (f) =>
      fs.readFileSync(path.join(REPO, f), 'utf8'),
    );
    expect(dangling).toEqual([]);
  });
});

describe('globToRegExp', () => {
  it('** spans depth, * stays within a segment, dots are literal', () => {
    expect(globToRegExp('src/**').test('src/server/engine.js')).toBe(true);
    expect(globToRegExp('src/**').test('other/src/x.js')).toBe(false);
    expect(globToRegExp('.github/**').test('.github/workflows/ci.yml')).toBe(true);
    expect(globToRegExp('docs/ARCHITECTURE.md').test('docs/ARCHITECTURE.md')).toBe(true);
    expect(globToRegExp('docs/ARCHITECTURE.md').test('docs/ARCHITECTUREXmd')).toBe(false);
  });
});

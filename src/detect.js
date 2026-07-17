// detect.js — framework, entry file, port detection (spec: blueprint 03-PARSING §A)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const err = (message, hint) => Object.assign(new Error(message), { code: 'USER', hint });

export function detectStack(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    // next before express: a project with the next dep IS a Next app (express is
    // occasionally present as a utility dep and would misroute detection)
    if (deps.next) {
      const appDir = ['app', 'src/app'].find((d) => {
        const abs = path.join(cwd, d);
        return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
      });
      if (!appDir)
        throw err(
          'Next.js detected but no App Router directory (app/ or src/app/).',
          'SPARDA supports the App Router only (route.js handlers) — the Pages Router is not supported.',
        );
      return {
        framework: 'nextjs',
        entryFile: appDir,
        port: detectNextPort(cwd, pkg),
        nextVersion: deps.next,
      };
    }
    // Medusa: file-based routing under `src/api` (`src/api/<path>/route.ts` — a route IS a
    // file). Detected by its STRUCTURAL signature — a src/api|api tree of `route.ts` files
    // exporting HTTP-verb handlers — not by a dep. The framework's own packages list
    // @medusajs/framework in devDeps and never depend on themselves, so a runtime-dep check
    // misses the framework repo entirely (the corpus `packages/medusa` clone). Checked BEFORE
    // express because a Medusa package lists `express` transitively; the express block would
    // otherwise find some stray `express()` call and misroute it to a 1-route express app
    // instead of its hundreds of file routes — making the corpus route count non-reproducible
    // out-of-the-box for a skeptic testing the framework repo directly (E-043).
    const medusaApi = medusaApiDir(cwd);
    if (medusaApi) return { framework: 'medusa', entryFile: medusaApi, port: 9000 };
    // A decorator-framework app (routes on `@Get`/`@Post` class methods, not
    // `app.get()`) is read by the decorator extractor even when `express` is a direct
    // dep and no `@nestjs/*` is present — n8n's home-made `@RestController` registry,
    // routing-controllers, etc. (ADR-055). Structural, brand-free: detected by the
    // presence of HTTP-verb decorators on classes, so a bespoke framework routes here
    // without being named. Checked before the express entry so a hybrid app (decorator
    // routes + an express bootstrap) is read by its routes, not its bootstrap.
    // Gated on `reflect-metadata` — the near-universal direct dep of decorator-metadata
    // frameworks (Nest, routing-controllers, n8n's @n8n/decorators): it keeps the bounded
    // source scan OFF the hot path for a classic express app (directus has no such dep),
    // so plain-express detection stays as cheap as before.
    const decoratorDir =
      deps.express && deps['reflect-metadata'] ? decoratorFrameworkDir(cwd) : null;
    if (decoratorDir) return { framework: 'nestjs', entryFile: decoratorDir, port: 3000 };
    if (deps.express) {
      // E-034: Nest/Medusa monsters (immich, twenty) list `express` as a DIRECT
      // dep. If no express() entry exists this is not an Express app — fall
      // through to the DI-framework checks below instead of hard-failing.
      // An app with no other framework marker keeps the original error (E-028's
      // tree-scan fallback already ran inside findExpressEntry).
      try {
        const entryFile = findExpressEntry(cwd, pkg);
        const moduleType = detectModuleType(cwd, pkg, entryFile);
        const port = detectExpressPort(cwd, entryFile);
        return {
          framework: 'express',
          entryFile,
          moduleType,
          port,
          expressVersion: deps.express,
        };
      } catch (e) {
        const otherFramework =
          deps['@nestjs/core'] ||
          deps['@nestjs/common'] ||
          deps['@medusajs/medusa'] ||
          deps['@medusajs/framework'];
        if (!otherFramework) throw e;
      }
    }
    // NestJS (and DI-framework) apps: routes live in @Controller classes,
    // scanned from the source tree rather than followed from a single entry.
    if (deps['@nestjs/core'] || deps['@nestjs/common']) {
      const entryFile = ['src', 'app', '.'].find((d) => {
        const abs = path.join(cwd, d);
        return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
      });
      return { framework: 'nestjs', entryFile: entryFile ?? '.', port: 3000 };
    }
    const known = ['fastify', 'koa'].find((d) => deps[d]);
    if (known)
      throw err(
        `${known} detected — not supported yet. Express, NestJS & FastAPI in v0.`,
        '+1 the framework vote: github.com/zyx77550/sparda/issues/1',
      );
  }
  for (const f of ['requirements.txt', 'pyproject.toml']) {
    const p = path.join(cwd, f);
    if (
      fs.existsSync(p) &&
      fs.readFileSync(p, 'utf8').toLowerCase().includes('fastapi')
    ) {
      const entryFile = findFastAPIEntry(cwd);
      const port = detectFastAPIPort(cwd, entryFile);
      const pythonCmd = detectPython();
      return { framework: 'fastapi', entryFile, port, pythonCmd };
    }
  }

  // Last resort before giving up — monorepo app dirs whose framework config lives
  // ELSEWHERE than the pointed dir. Purely structural, so it never mis-fires on a
  // real app (which already detected above via its own deps):
  //   (1) a decorator app with NO local package.json — ghostfolio's Nx `apps/api`
  //       has 34 @Controller files but its @nestjs dep is at the monorepo root.
  const structDir = decoratorFrameworkDir(cwd);
  if (structDir) return { framework: 'nestjs', entryFile: structDir, port: 3000 };
  //   (2) a FastAPI app whose requirements/pyproject sits UP the tree — langflow's
  //       `src/backend/base/langflow` declares fastapi one directory up.
  if (fastAPIUpTree(cwd)) {
    const entryFile = findFastAPIEntry(cwd);
    return {
      framework: 'fastapi',
      entryFile,
      port: detectFastAPIPort(cwd, entryFile),
      pythonCmd: detectPython(),
    };
  }

  const suggestions = suggestAppDirs(cwd);
  throw err(
    'No supported framework found (Express, Next.js, NestJS, Medusa, FastAPI).',
    suggestions.length
      ? `This looks like a monorepo — the analyzable app is in a sub-directory. Try:\n` +
          suggestions
            .slice(0, 6)
            .map((s) => `      cd ${s.dir}   # looks like ${s.framework}`)
            .join('\n')
      : 'Run SPARDA inside your project root, next to the app that defines routes.',
  );
}

// When detection finds nothing (or a compile resolves 0 routes), the user is very often
// standing at a monorepo root with the real app one directory down. Rather than a dead
// "0 routes", point them at it: scan the conventional monorepo containers for sub-dirs that
// LOOK like an analyzable app. Deliberately CHEAP — package.json framework deps + structural
// signatures only, never the heavy entry-file tree scan `detectStack` does — because this
// runs on the failure path and must stay instant. Deterministic order; returns [] on a plain
// non-monorepo dir (nothing to suggest). Never throws.
export function suggestAppDirs(cwd) {
  const containers = ['.', 'apps', 'packages', 'services', 'backend', 'apis', 'src'];
  const seen = new Set();
  const found = [];
  for (const container of containers) {
    const base = container === '.' ? cwd : path.join(cwd, container);
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules')
        continue;
      const rel = container === '.' ? e.name : `${container}/${e.name}`;
      const abs = path.join(cwd, rel);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (found.length >= 12) return found;
      const framework = looksLikeApp(abs);
      if (framework) found.push({ dir: rel, framework });
    }
  }
  return found;
}

// A cheap "is this an app?" probe: framework dep in package.json, or a framework's structural
// signature (Medusa's src/api route tree, Next's app dir, a FastAPI declaration). No entry
// search — a hint, not a proof. Returns a framework label or null.
function looksLikeApp(abs) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return 'Next.js';
    if (deps['@nestjs/core'] || deps['@nestjs/common']) return 'NestJS';
    if (deps['@medusajs/medusa'] || deps['@medusajs/framework']) return 'Medusa';
    if (deps.express) return 'Express';
    if (deps.fastify) return 'Fastify (unsupported)';
    if (deps.koa) return 'Koa (unsupported)';
  } catch {
    // no/invalid package.json — fall through to structural checks
  }
  if (medusaApiDir(abs)) return 'Medusa';
  for (const d of ['app', 'src/app']) {
    try {
      if (fs.statSync(path.join(abs, d)).isDirectory()) return 'Next.js';
    } catch {
      // not this one
    }
  }
  for (const f of ['requirements.txt', 'pyproject.toml']) {
    try {
      if (fs.readFileSync(path.join(abs, f), 'utf8').toLowerCase().includes('fastapi'))
        return 'FastAPI';
    } catch {
      // not this one
    }
  }
  return null;
}

// Walk UP a bounded number of levels for a requirements.txt/pyproject.toml declaring
// fastapi — a Python app pointed at a sub-package whose deps sit at the backend root.
function fastAPIUpTree(cwd) {
  let dir = cwd;
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    for (const f of ['requirements.txt', 'pyproject.toml']) {
      const p = path.join(dir, f);
      try {
        if (
          fs.existsSync(p) &&
          fs.readFileSync(p, 'utf8').toLowerCase().includes('fastapi')
        )
          return true;
      } catch {
        // unreadable — keep walking
      }
    }
  }
  return false;
}

// Is this a decorator-framework app? (ADR-055) Routes on `@Get`/`@Post` class methods
// rather than `app.get()`. Structural + brand-free: we look for HTTP-verb decorators
// applied on a class, in the conventional source dirs. Bounded HARD (cap files, short-
// circuit at 3 hits) so this stays a cheap one-time detection cost even on a monster.
// Returns the source dir to hand the decorator extractor, or null.
const VERB_DECORATOR_CALL = /@(?:Http)?(?:Get|Post|Put|Patch|Delete)(?:Mapping)?\s*\(/;
function decoratorFrameworkDir(cwd) {
  for (const srcDir of ['src', 'app', '.']) {
    const abs = path.join(cwd, srcDir);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let hits = 0;
    let seen = 0;
    for (const file of walkSourceFiles(abs, 500)) {
      if (++seen > 500) break;
      let head;
      try {
        head = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (VERB_DECORATOR_CALL.test(head) && /\bclass\s/.test(head) && ++hits >= 3)
        return srcDir;
    }
  }
  return null;
}

// Medusa's file-based routing signature: a `src/api` (or `api`) tree whose leaf files are
// named `route.{ts,js,…}` and export HTTP-verb handlers (`export const GET = …`). Structural
// and unambiguous — Express routes via `router.get()`, Next's `route.ts` files live under
// `app/` (and Next is detected earlier by its dep) — so this identifies a Medusa app with NO
// dep at all. Cheap on a non-Medusa app: two statSync calls when neither dir exists. Bounded
// + short-circuits at the first verb-exporting route file. Returns the api dir, or null.
const MEDUSA_ROUTE_EXPORT =
  /export\s+(?:const|(?:async\s+)?function)\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/;
function medusaApiDir(cwd) {
  for (const rel of ['src/api', 'api']) {
    const abs = path.join(cwd, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const file of walkSourceFiles(abs, 500)) {
      if (!/(^|[\\/])route\.(m?[tj]s|cjs)$/.test(file)) continue;
      let src;
      try {
        src = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (MEDUSA_ROUTE_EXPORT.test(src)) return rel;
    }
  }
  return null;
}

const DECO_EXCLUDE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.sparda',
]);
function* walkSourceFiles(dir, cap, budget = { n: 0 }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (budget.n >= cap) return;
    if (DECO_EXCLUDE.has(e.name) || e.name.includes('__tests__')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkSourceFiles(abs, cap, budget);
    } else if (
      /\.(m?ts|m?js|cts|cjs)$/.test(e.name) &&
      !/\.(d\.ts|test|spec)\./.test(e.name)
    ) {
      budget.n++;
      yield abs;
    }
  }
}

// `next dev -p 3001` / `--port 3001` in scripts, then PORT= in .env, then 3000
function detectNextPort(cwd, pkg) {
  for (const script of [pkg.scripts?.dev, pkg.scripts?.start]) {
    if (!script) continue;
    const m = script.match(/(?:-p|--port)[\s=]+(\d{2,5})/);
    if (m) return Number(m[1]);
  }
  const envPath = path.join(cwd, '.env');
  if (fs.existsSync(envPath)) {
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('PORT='));
    if (line) {
      const v = Number(line.split('=')[1].trim());
      if (v) return v;
    }
  }
  return 3000;
}

function detectPython() {
  const cmds = ['python3', 'python', 'py'];
  for (const cmd of cmds) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    try {
      const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2000 });
      if (res.status === 0) {
        const out = (res.stdout || res.stderr || '').trim();
        const m = out.match(/Python\s+(\d+\.\d+\.\d+)/i);
        if (m) {
          const ver = m[1];
          const [major, minor] = ver.split('.').map(Number);
          if (major === 3 && minor >= 9) {
            return cmd;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  throw err(
    'Python 3 (>= 3.9) introuvable dans le PATH.',
    'Installe Python >= 3.9 pour utiliser SPARDA sur un projet FastAPI.',
  );
}

function findFastAPIEntry(cwd) {
  const candidates = ['main.py', 'app.py', 'src/main.py', 'app/main.py'];
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const src = fs.readFileSync(abs, 'utf8');
      if (src.includes('FastAPI(')) {
        return path.relative(cwd, abs).split(path.sep).join('/');
      }
    }
  }

  const entry = searchPyFiles(cwd, cwd);
  if (entry) {
    return path.relative(cwd, entry).split(path.sep).join('/');
  }

  throw err(
    'Could not locate your FastAPI entry file (the one calling FastAPI()).',
    'Specify it manually, or make sure FastAPI() is declared in one of your python files.',
  );
}

function searchPyFiles(dir, root, countRef = { val: 0 }) {
  const EXCLUDE = new Set([
    'node_modules',
    '.git',
    'venv',
    '.venv',
    'tests',
    '__pycache__',
  ]);
  let items;
  try {
    items = fs.readdirSync(dir);
  } catch {
    return null;
  }

  for (const item of items) {
    const abs = path.join(dir, item);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (EXCLUDE.has(item)) continue;
      const found = searchPyFiles(abs, root, countRef);
      if (found) return found;
    } else if (stat.isFile() && item.endsWith('.py')) {
      countRef.val++;
      if (countRef.val > 200) return null;
      const src = fs.readFileSync(abs, 'utf8');
      if (src.includes('FastAPI(')) {
        return abs;
      }
    }
  }
  return null;
}

function detectFastAPIPort(cwd, entryFile) {
  const abs = path.resolve(cwd, entryFile);
  if (!fs.existsSync(abs)) return 8000;
  const src = fs.readFileSync(abs, 'utf8');
  const m = src.match(/uvicorn\.run\([^)]*port\s*=\s*(\d+)/s);
  if (m) return Number(m[1]);
  return 8000;
}

function findExpressEntry(cwd, pkg) {
  const candidates = [];
  if (pkg.main) candidates.push(pkg.main);
  for (const script of [pkg.scripts?.dev, pkg.scripts?.start]) {
    if (!script) continue;
    const m = script.match(/(\S+\.(?:m?[tj]s|cjs))\s*$/);
    if (m) candidates.push(m[1]);
  }
  candidates.push(
    'src/app.ts',
    'src/server.ts',
    'src/index.ts',
    'src/main.ts', // Nx / NestJS-style monorepo layout
    'src/commands/start.ts',
    'main.ts',
    'app.ts',
    'server.ts',
    'index.ts',
    'src/app.js',
    'src/server.js',
    'src/index.js',
    'app.js',
    'server.js',
    'index.js',
    'src/app.mjs',
    'app.mjs',
    'index.mjs',
  );
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const src = fs.readFileSync(abs, 'utf8');
      if (/express\s*\(/.test(src))
        return path.relative(cwd, abs).split(path.sep).join('/');
    }
  }
  // No standard-named entry matched — the app's entry is a non-conventional file
  // (`ParseServer.ts`, `bootstrap.ts`, `application.ts`, …). Scan the tree for the
  // file that actually creates the app (a bare `express()` call), the same fallback
  // FastAPI detection already uses. Ranked so a real server (`.listen()`) wins.
  const found = searchExpressEntry(cwd);
  if (found) return found;
  throw err(
    'Could not locate your Express entry file (the one calling express()).',
    'Re-run from the project root, or open an issue with your layout.',
  );
}

// Bounded source-tree scan for the app-creation file: a bare `express()` call (not
// `express.Router()`/`express.static()`). Ranked: a file that also `.listen()`s (a
// real server entry) beats a library file; then shallower path; then alphabetical —
// deterministic. Caps the number of files read so a giant repo can't stall detection.
function searchExpressEntry(cwd) {
  const EXCLUDE = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.sparda',
    'test',
    'tests',
    '__tests__',
    'spec',
    'examples',
    'example',
  ]);
  const APP_CALL = /(?<![.\w])express\s*\(\s*\)/; // `express()` app factory
  // Conventional entry basenames get their OWN budget, so a giant's entry is found no
  // matter how deep it sits (Ghost's `core/shared/express.js` lives past 1000+ files —
  // the old flat 400-file cap ran out before reaching it, and a real Express app then
  // hard-failed). Entry-named files are rare, so scanning them tree-wide stays cheap.
  const ENTRY_NAME =
    /^(express|app|server|index|main|bootstrap|application|boot)\.(m?[tj]s|cjs)$/;
  const nameMatches = [];
  const otherMatches = [];
  const budget = { name: 0, other: 0 };
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDE.has(e.name)) walk(abs);
        continue;
      }
      if (!/\.(m?[tj]s|cjs)$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
      const isEntry = ENTRY_NAME.test(e.name);
      if (isEntry ? budget.name++ > 600 : budget.other++ > 400) continue;
      let src;
      try {
        src = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (APP_CALL.test(src)) {
        const rel = path.relative(cwd, abs).split(path.sep).join('/');
        (isEntry ? nameMatches : otherMatches).push({
          rel,
          listens: /\.listen\s*\(/.test(src),
          depth: rel.split('/').length,
        });
      }
    }
  };
  walk(cwd);
  // a real server (.listen) wins, then shallower path, then alphabetical — deterministic.
  const rank = (a, b) =>
    Number(b.listens) - Number(a.listens) ||
    a.depth - b.depth ||
    (a.rel < b.rel ? -1 : 1);
  const bucket = nameMatches.length ? nameMatches : otherMatches;
  if (!bucket.length) return null;
  bucket.sort(rank);
  return bucket[0].rel;
}

function detectModuleType(cwd, pkg, entryFile) {
  if (entryFile.endsWith('.mjs')) return 'esm';
  if (entryFile.endsWith('.cjs')) return 'cjs';
  if (pkg.type === 'module' || entryFile.endsWith('.ts')) {
    const src = fs.readFileSync(path.join(cwd, entryFile), 'utf8');
    if (
      /^\s*(const|let|var)\s+\w+\s*=\s*require\(/m.test(src) &&
      !/^\s*import\s/m.test(src)
    )
      return 'cjs';
    return 'esm';
  }
  const src = fs.readFileSync(path.join(cwd, entryFile), 'utf8');
  return /^\s*import\s.+from\s/m.test(src) ? 'esm' : 'cjs';
}

function detectExpressPort(cwd, entryFile) {
  const src = fs.readFileSync(path.join(cwd, entryFile), 'utf8');
  let m = src.match(/\.listen\(\s*(\d{2,5})/);
  if (m) return Number(m[1]);
  m = src.match(/\.listen\(\s*(?:process\.env\.(\w+))/);
  if (m) {
    const envPath = path.join(cwd, '.env');
    if (fs.existsSync(envPath)) {
      const line = fs
        .readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.startsWith(`${m[1]}=`));
      if (line) {
        const v = Number(line.split('=')[1].trim());
        if (v) return v;
      }
    }
  }
  // env fallback literal, wrapped or not: Number(process.env.PORT ?? 4477), process.env.APP_PORT || 4488
  m = src.match(/process\.env\.\w*PORT\w*\s*(?:\?\?|\|\|)\s*(\d{2,5})/i);
  if (m) return Number(m[1]);
  // PORT env var or const PORT = 3000 pattern
  m = src.match(/(?:PORT|port)\s*=\s*(?:process\.env\.\w+\s*(?:\|\||\?\?)\s*)?(\d{2,5})/);
  if (m) return Number(m[1]);
  return 3000; // default + warning emitted by caller
}

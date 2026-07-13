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
    if (deps.express) {
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
    }
    // Medusa: file-based routing under src/api — a route IS a file
    // (`src/api/<path>/route.ts`), not an `app.get()` or a @Controller. Checked
    // before Nest because a Medusa app may transitively pull Nest deps.
    if (deps['@medusajs/medusa'] || deps['@medusajs/framework']) {
      const apiDir = ['src/api', 'api'].find((d) => {
        const abs = path.join(cwd, d);
        return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
      });
      if (apiDir) return { framework: 'medusa', entryFile: apiDir, port: 9000 };
      // Medusa dep but no api dir: fall through (a plugin/lib package, not an app).
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
  throw err(
    'No supported framework found (Express, FastAPI).',
    'Run sparda-mcp inside your project root, next to package.json.',
  );
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
  const matches = [];
  const budget = { files: 0 };
  const walk = (dir) => {
    if (budget.files > 400) return;
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
      } else if (/\.(m?[tj]s|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        if (budget.files++ > 400) return;
        let src;
        try {
          src = fs.readFileSync(abs, 'utf8');
        } catch {
          continue;
        }
        if (APP_CALL.test(src)) {
          const rel = path.relative(cwd, abs).split(path.sep).join('/');
          matches.push({
            rel,
            listens: /\.listen\s*\(/.test(src),
            depth: rel.split('/').length,
          });
        }
      }
    }
  };
  walk(cwd);
  if (!matches.length) return null;
  matches.sort(
    (a, b) =>
      Number(b.listens) - Number(a.listens) ||
      a.depth - b.depth ||
      (a.rel < b.rel ? -1 : 1),
  );
  return matches[0].rel;
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

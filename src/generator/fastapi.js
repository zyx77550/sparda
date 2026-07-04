// generator/fastapi.js — router generation + python injection (spec: blueprint 04-GENERATION §A)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toolNameFor } from '../parser/express.js';
import { carryOverManifest, defaultSpardingMemory, ensureSpardaKey } from './manifest.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARK_START = '# >>> sparda-injection (do not edit this block) >>>';
const MARK_END = '# <<< sparda-injection <<<';

export function generateFastAPI({
  cwd,
  entryFile,
  port,
  routes,
  entryAppVars,
  pythonCmd = 'python',
}) {
  const taken = new Set([
    'sparda_info',
    'sparda_list_disabled_tools',
    'sparda_get_context',
  ]);
  const tools = {};
  for (const r of routes) {
    const name = toolNameFor(r, taken);
    tools[name] = {
      method: r.method.toUpperCase(),
      path: r.path,
      enabled: !r.mutating, // write-safety: mutating tools off by default
      pathParams: r.params.filter((p) => p.in === 'path').map((p) => p.name),
      description: r.description,
      params: r.params,
      confidence: r.confidence,
    };
  }
  const prev = carryOverManifest(cwd, tools);

  // --- sparding safety memory & fingerprints
  const sparding = defaultSpardingMemory(prev);
  const oldFingerprints = sparding.toolFingerprints ?? {};
  const newFingerprints = {};
  for (const [name, t] of Object.entries(tools)) {
    const raw = `${t.method}|${t.path}|${JSON.stringify(t.params)}`;
    const fp = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
    newFingerprints[name] = fp;
    const oldFp = oldFingerprints[name];
    if (oldFp && oldFp !== fp) {
      sparding.events.push({
        ts: new Date().toISOString(),
        tool: name,
        decision: 'audit',
        risk: 'medium',
        reasons: [
          `route structure modified (fingerprint changed from ${oldFp} to ${fp})`,
        ],
      });
      if (sparding.events.length > 100) sparding.events.shift();
    }
  }
  sparding.toolFingerprints = newFingerprints;

  // stable across re-runs so a running bridge/host pair never desyncs
  const localKey = ensureSpardaKey(cwd, prev);
  const entryAbs = path.resolve(cwd, entryFile);
  const entryDir = path.dirname(entryAbs);
  const routerFileName = 'sparda_router.py';
  const routerAbs = path.join(entryDir, routerFileName);

  // --- render router from template
  let tpl = fs.readFileSync(
    path.join(__dirname, '..', '..', 'templates', 'fastapi-router.txt'),
    'utf8',
  );
  tpl = tpl
    // double-stringify: a JSON string literal is also a valid Python string literal,
    // and json.loads() in the template turns it into real Python values (E-009)
    .replace('__TOOLS_JSON__', JSON.stringify(JSON.stringify(tools)))
    .replace(
      '__SPARDING_POLICIES__',
      JSON.stringify(JSON.stringify(sparding.policies ?? {})),
    )
    .replace('__LOCAL_KEY__', localKey)
    .replace('__PORT__', String(port));

  atomicWrite(routerAbs, tpl);

  // --- inject into entry file (regex-based with compilation safety check)
  const injection = injectIntoEntry({
    entryAbs,
    routerFileName,
    cwd,
    entryAppVars,
    pythonCmd,
  });

  // record what init did to .gitignore so `remove` can revert it exactly (hard rule #4, E-010)
  const gitignore = ensureGitignore(cwd) ?? prev?.gitignore ?? null;

  // --- manifest
  const manifest = {
    version: 1,
    framework: 'fastapi',
    entryFile,
    port,
    localKey,
    generatedFiles: [path.relative(cwd, routerAbs).split(path.sep).join('/')],
    injectedFiles: injection.injected ? [entryFile] : [],
    createdAt: new Date().toISOString(),
    tools: Object.fromEntries(
      Object.entries(tools).map(([k, v]) => [
        k,
        { method: v.method, path: v.path, enabled: v.enabled },
      ]),
    ),
    ...(gitignore ? { gitignore } : {}),
    ...(prev?.semantic ? { semantic: prev.semantic } : {}),
    ...(prev?.immune ? { immune: prev.immune } : {}),
    ...(prev?.labs ? { labs: prev.labs } : {}),
    sparding,
  };

  const manifestOnDisk = { ...manifest };
  if (!process.env.VITEST) {
    delete manifestOnDisk.localKey;
  }
  atomicWrite(
    path.join(cwd, 'sparda.json'),
    JSON.stringify(manifestOnDisk, null, 2) + '\n',
  );

  return {
    tools,
    manifest,
    routerFile: path.relative(cwd, routerAbs).split(path.sep).join('/'),
    injection,
  };
}

function injectIntoEntry({ entryAbs, cwd, pythonCmd }) {
  const src = fs.readFileSync(entryAbs, 'utf8');

  // backup first
  const backupDir = path.join(cwd, '.sparda', 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `${path.basename(entryAbs)}.${Date.now()}`), src);

  // Determine if directory has __init__.py (relative vs absolute import)
  const entryDir = path.dirname(entryAbs);
  const hasInit = fs.existsSync(path.join(entryDir, '__init__.py'));
  const importLine = hasInit
    ? 'from .sparda_router import sparda_router'
    : 'from sparda_router import sparda_router';

  // preserve the file's own line endings (Windows checkouts are CRLF)
  const eol = src.includes('\r\n') ? '\r\n' : '\n';

  // strip previous injection blocks (idempotence)
  let body = src;
  const blockRx = new RegExp(
    `\\r?\\n?${escapeRx(MARK_START)}[\\s\\S]*?${escapeRx(MARK_END)}\\r?\\n?`,
    'g',
  );
  body = body.replace(blockRx, eol);

  // Let's find the FastAPI() call assignment to inject right after it
  // ([ \t]*) — NOT (\s*): \s matches newlines and would swallow blank lines/CR into the "indent" (E-007)
  const match = body.match(/^([ \t]*)(\w+)\s*=\s*(?:\w+\.)?FastAPI\(/m);
  if (!match) {
    return {
      injected: false,
      manual: [importLine, 'app.include_router(sparda_router, prefix="/mcp")'],
    };
  }

  const indent = match[1];
  const appName = match[2];

  // Prepare injection block
  const useBlock = [
    MARK_START,
    `${indent}${importLine}`,
    `${indent}${appName}.include_router(sparda_router, prefix="/mcp")`,
    MARK_END,
  ];

  // We find where the matching line starts and ends in order to insert right after it.
  const lines = body.split(/\r?\n/);
  let insertAt = -1;
  const linePattern = new RegExp(`^[ \\t]*${appName}\\s*=\\s*(?:\\w+\\.)?FastAPI\\(`);
  for (let i = 0; i < lines.length; i++) {
    if (linePattern.test(lines[i])) {
      insertAt = i + 1; // Insert AFTER this line
      break;
    }
  }

  if (insertAt === -1) {
    return {
      injected: false,
      manual: [importLine, `${appName}.include_router(sparda_router, prefix="/mcp")`],
    };
  }

  lines.splice(insertAt, 0, ...useBlock);
  const out = lines.join(eol);

  // Post-injection compilation check to avoid syntax errors
  if (!verifyPythonSyntax(entryAbs, out, pythonCmd)) {
    return {
      injected: false,
      manual: [importLine, `${appName}.include_router(sparda_router, prefix="/mcp")`],
    };
  }

  atomicWrite(entryAbs, out);
  return { injected: true, manual: null };
}

export function removeInjection(cwd, manifest, pythonCmd = 'python') {
  const results = [];
  for (const relFile of manifest.injectedFiles ?? []) {
    const abs = path.resolve(cwd, relFile);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    const blockRx = new RegExp(
      `\\r?\\n?${escapeRx(MARK_START)}[\\s\\S]*?${escapeRx(MARK_END)}`,
      'g',
    );
    const out = src.replace(blockRx, '');

    if (verifyPythonSyntax(abs, out, pythonCmd)) {
      atomicWrite(abs, out);
      results.push({ file: relFile, ok: true });
    } else {
      results.push({ file: relFile, ok: false });
    }
  }
  return results;
}

function verifyPythonSyntax(filePath, content, pythonCmd) {
  const tmpFile = `${filePath}.syntax-check.py`;
  try {
    fs.writeFileSync(tmpFile, content);
    const args =
      pythonCmd === 'py'
        ? ['-3', '-m', 'py_compile', tmpFile]
        : ['-m', 'py_compile', tmpFile];
    // py_compile cold-starts slowly on Windows; a 2s budget falsely failed clean
    // removals (rule #4) and post-injection checks under load. 5s matches the
    // test-side syntax budget and only bounds the worst case, never the happy path.
    const res = spawnSync(pythonCmd, args, { timeout: 5000 });
    return res.status === 0;
  } catch {
    return false;
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

// Returns what was done ('created' | 'appended' | null) so the manifest can
// record it and `remove` can revert the exact edit (byte-for-byte promise).
function ensureGitignore(cwd) {
  const gi = path.join(cwd, '.gitignore');
  const line = '.sparda/';
  if (fs.existsSync(gi)) {
    const content = fs.readFileSync(gi, 'utf8');
    if (content.split(/\r?\n/).includes(line)) return null;
    fs.appendFileSync(gi, `\n${line}\n`);
    return 'appended';
  }
  fs.writeFileSync(gi, `${line}\n`);
  return 'created';
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

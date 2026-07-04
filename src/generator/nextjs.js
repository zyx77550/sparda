// generator/nextjs.js — file-based injection for the App Router.
// Next.js has no `app = express()` line to inject after: the filesystem is the
// router, so SPARDA's injection IS a generated catch-all route handler at
// <appDir>/mcp/[...sparda]/route.js. Nothing in the user's code is touched —
// `remove` deletes the file and the diff is clean by construction.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { toolNameFor } from '../parser/express.js';
import { ensureGitignore } from './express.js';
import { carryOverManifest, defaultSpardingMemory, ensureSpardaKey } from './manifest.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function generateNext({ cwd, appDir, port, routes }) {
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

  // --- sparding safety memory & fingerprints (same contract as Express/FastAPI)
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

  // .js on purpose: Next enables allowJs in the tsconfig it manages, so the
  // generated handler compiles untouched inside TS projects too.
  const routerRel = `${appDir}/mcp/[...sparda]/route.js`;
  const routerAbs = path.join(cwd, ...routerRel.split('/'));
  fs.mkdirSync(path.dirname(routerAbs), { recursive: true });

  let tpl = fs.readFileSync(
    path.join(__dirname, '..', '..', 'templates', 'nextjs-router.txt'),
    'utf8',
  );
  tpl = tpl
    .replace('__TOOLS_JSON__', JSON.stringify(tools, null, 2))
    .replace('__SPARDING_POLICIES__', JSON.stringify(sparding.policies ?? {}))
    .replace('__LOCAL_KEY__', localKey)
    .replace('__PORT__', String(port));
  atomicWrite(routerAbs, tpl);

  const gitignore = ensureGitignore(cwd) ?? prev?.gitignore ?? null;

  const manifest = {
    version: 1,
    framework: 'nextjs',
    entryFile: appDir, // the scanned App Router root, not a code entry point
    port,
    localKey,
    generatedFiles: [routerRel],
    injectedFiles: [], // file-based injection: no user file is ever modified
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
    routerFile: routerRel,
    injection: { injected: false, manual: null, fileBased: true },
  };
}

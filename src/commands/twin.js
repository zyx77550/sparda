// commands/twin.js — R3.2, the holographic principle: reconstruct a living
// mock of the app from its boundary (manifest structure + observed I/O).
//
// Two verbs, one value boundary (ADR-021):
//   sparda twin --learn   asks the LIVE router once per eligible GET tool and
//                         stores capped exemplars in .sparda/twin.json —
//                         machine-local, gitignored, never the manifest.
//   sparda twin           serves the clone: same routes, same /mcp surface,
//                         answered from exemplars. Writes return 202 echoes
//                         and touch nothing. Stop the app, run the twin, and
//                         every agent exercises a ghost instead of the truth.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';
import { resolveSpardaKey } from '../generator/manifest.js';

const EXEMPLAR_CAP = 16384; // 16KB per exemplar — a shape, not an archive

export function twinFilePath(cwd) {
  return path.join(cwd, '.sparda', 'twin.json');
}

// ── learn: one real call per eligible tool, through the live router ────────

export function eligibleForLearning(tool) {
  return tool.enabled && tool.method === 'GET' && (tool.pathParams ?? []).length === 0;
}

export async function learnExemplars(manifest, localKey, fetchFn = fetch) {
  let key = localKey;
  if (typeof localKey === 'function') {
    fetchFn = localKey;
    key = undefined;
  }
  key = key ?? manifest.localKey ?? resolveSpardaKey(process.cwd(), manifest);

  const exemplars = {};
  const skipped = [];
  for (const [name, t] of Object.entries(manifest.tools ?? {})) {
    if (!eligibleForLearning(t)) {
      skipped.push({
        tool: name,
        reason: !t.enabled
          ? 'disabled'
          : t.method !== 'GET'
            ? 'write tool — a twin never learns from side effects'
            : 'required path params — no observed values to fill them (v0.1)',
      });
      continue;
    }
    try {
      const res = await fetchFn(`http://127.0.0.1:${manifest.port}/mcp/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sparda-key': key,
        },
        body: JSON.stringify({ tool: name, args: {} }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await res.json();
      if (payload?.upstreamStatus === 200 && payload.data !== undefined) {
        const raw = JSON.stringify(payload.data);
        if (raw.length <= EXEMPLAR_CAP) {
          exemplars[name] = { data: payload.data, learnedAt: new Date().toISOString() };
        } else {
          skipped.push({ tool: name, reason: `response over ${EXEMPLAR_CAP}B cap` });
        }
      } else {
        skipped.push({
          tool: name,
          reason: `live call answered ${payload?.upstreamStatus ?? res.status}`,
        });
      }
    } catch (err) {
      skipped.push({ tool: name, reason: `unreachable: ${err.message}` });
    }
  }
  return { exemplars, skipped };
}

// ── serve: the ghost — same routes, same /mcp surface, zero side effects ───

function matchTool(manifest, method, pathname) {
  for (const [name, t] of Object.entries(manifest.tools ?? {})) {
    if (t.method !== method) continue;
    const pattern = t.path.replace(/:(\w+)/g, '([^/]+)');
    if (new RegExp(`^${pattern}$`).test(pathname)) return { name, tool: t };
  }
  return null;
}

export function createTwinServer(manifest, localKeyOrExemplars, maybeExemplars) {
  let localKey = localKeyOrExemplars;
  let exemplars = maybeExemplars;
  if (
    maybeExemplars === undefined &&
    localKeyOrExemplars &&
    typeof localKeyOrExemplars === 'object'
  ) {
    exemplars = localKeyOrExemplars;
    localKey = resolveSpardaKey(process.cwd(), manifest);
  }
  const json = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const answerFor = (name) =>
    (exemplars ?? {})[name]?.data !== undefined
      ? exemplars[name].data
      : {
          __sparda_twin__: true,
          tool: name,
          note: 'no exemplar learned — run `sparda twin --learn` against the live app',
        };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    // the /mcp surface, so the unchanged bridge drives the ghost
    if (pathname.startsWith('/mcp')) {
      if (req.headers['x-sparda-key'] !== localKey)
        return json(res, 401, { error: 'unauthorized' });
      if (pathname === '/mcp/tools') return json(res, 200, manifest.tools ?? {});
      if (pathname === '/mcp/stats')
        return json(res, 200, {
          twin: true,
          uptimeSec: Math.round(process.uptime()),
          stats: {},
          quarantine: {},
          recycle: { servedByCircle: 0, paidFull: 0, ratePct: 0 },
          purity: {},
        });
      if (pathname === '/mcp/events')
        return json(res, 200, { seq: 0, events: [], twin: true });
      if (pathname === '/mcp/invoke' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 65536) return json(res, 413, { error: 'payload too large' });
        }
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          return json(res, 400, { error: 'invalid JSON body' });
        }
        const spec = manifest.tools?.[parsed.tool];
        if (!spec)
          return json(res, 404, { error: `unknown tool: ${parsed.tool}`, twin: true });
        if (spec.method !== 'GET')
          return json(res, 200, {
            upstreamStatus: 202,
            data: {
              __sparda_twin__: true,
              echo: parsed.args ?? {},
              note: 'twin: write acknowledged, nothing was touched',
            },
            twin: true,
          });
        return json(res, 200, {
          upstreamStatus: 200,
          data: answerFor(parsed.tool),
          twin: true,
        });
      }
      return json(res, 404, { error: 'not found', twin: true });
    }

    // the plain routes themselves, for anything that talks HTTP directly
    const hit = matchTool(manifest, req.method, pathname);
    if (!hit)
      return json(res, 404, {
        __sparda_twin__: true,
        error: 'route not in the manifest',
      });
    if (hit.tool.method !== 'GET')
      return json(res, 202, {
        __sparda_twin__: true,
        note: 'twin: write acknowledged, nothing was touched',
      });
    return json(res, 200, answerFor(hit.name));
  });
}

// ── the command ─────────────────────────────────────────────────────────────

export async function runTwin(opts, args) {
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found.'), {
      code: 'USER',
      hint: 'run `npx sparda-mcp init` first',
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const localKey = resolveSpardaKey(opts.cwd, manifest);
  const twinPath = twinFilePath(opts.cwd);

  if (args.includes('--learn') || opts.learn) {
    console.error(
      '[sparda] twin: learning from the LIVE app (one call per eligible GET)...',
    );
    const { exemplars, skipped } = await learnExemplars(manifest, localKey);
    const learned = Object.keys(exemplars).length;
    if (!learned && skipped.every((s) => s.reason.startsWith('unreachable'))) {
      throw Object.assign(
        new Error(
          `host unreachable on :${manifest.port} — the twin learns from the living.`,
        ),
        {
          code: 'USER',
          hint: 'start the app, then re-run `npx sparda-mcp twin --learn`',
        },
      );
    }
    fs.mkdirSync(path.dirname(twinPath), { recursive: true });
    atomicWrite(
      twinPath,
      JSON.stringify(
        { version: 'sparda-twin/v1', learnedAt: new Date().toISOString(), exemplars },
        null,
        2,
      ),
    );
    console.log(
      `✓ Twin learned ${learned} exemplar(s) → .sparda/twin.json (local only, never committed, never seeded)`,
    );
    for (const s of skipped) console.log(`  · skipped ${s.tool}: ${s.reason}`);
    return { learned, skipped };
  }

  let exemplars = {};
  if (fs.existsSync(twinPath)) {
    try {
      exemplars = JSON.parse(fs.readFileSync(twinPath, 'utf8')).exemplars ?? {};
    } catch {
      /* corrupt twin file → shape-only ghost, stated per answer */
    }
  }
  const port = Number(opts.port) || manifest.port;
  const server = createTwinServer(manifest, localKey, exemplars);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((err) => {
    throw Object.assign(
      new Error(
        `cannot listen on :${port} — ${err.code === 'EADDRINUSE' ? 'the real app is still running there' : err.message}`,
      ),
      {
        code: 'USER',
        hint: 'stop the app first (the twin replaces it), or pass --port <n>',
      },
    );
  });
  console.log(
    `✓ Twin serving on :${port} — ${Object.keys(exemplars).length} exemplar(s), writes are 202 echoes, the real app is untouched`,
  );
  console.log(
    '  Connect the bridge as usual (`npx sparda-mcp dev`) — it cannot tell the ghost from the flesh.',
  );
  return { server, port };
}

// ubg/fastapi.js — FastAPI codebase → route facts for the UBG translator.
// Python parses Python: fastapi_extract.py (stdlib ast, zero pip deps) walks
// the project and returns route facts whose chain steps carry PRE-COMPUTED
// scans in the exact shape of extract.js#scanFunction. From the translator's
// point of view a FastAPI dependency and an Express middleware are the same
// thing — which is the whole point of an IR.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function extractFastAPI(cwd, entryFile, pythonCmd = 'python') {
  const script = path.resolve(__dirname, 'fastapi_extract.py');
  const args =
    pythonCmd === 'py' ? ['-3', script, entryFile, cwd] : [script, entryFile, cwd];
  const res = spawnSync(pythonCmd, args, { cwd, encoding: 'utf8', timeout: 30_000 });

  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim().slice(0, 300);
    throw Object.assign(new Error(`FastAPI UBG extraction failed: ${detail}`), {
      code: 'USER',
      hint: 'the UBG compiler needs Python >= 3.9 on the PATH for FastAPI projects',
    });
  }

  let payload;
  try {
    payload = JSON.parse(res.stdout.trim());
  } catch (err) {
    throw new Error(
      `FastAPI UBG extractor returned invalid JSON: ${err.message}. Raw: ${res.stdout.slice(0, 200)}`,
    );
  }
  if (payload.error) throw new Error(payload.error);

  const skipped = payload.skipped ?? [];

  // global middlewares: FastAPI(dependencies=[…]) + @app.middleware('http')
  const globalMiddlewares = [];
  for (const gm of payload.globalMiddlewares ?? []) {
    if (gm.resolved) {
      globalMiddlewares.push({ ...gm.resolved, role: 'middleware' });
    } else {
      skipped.push({
        reason: `global dependency '${gm.target}' not resolved`,
        file: null,
      });
    }
  }

  return {
    routes: payload.routes ?? [],
    globalMiddlewares,
    helpers: payload.helpers ?? [],
    skipped,
    scannedFiles: payload.scannedFiles ?? [],
  };
}

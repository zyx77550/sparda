// parser/fastapi.js — JS wrapper executing Python AST extractor (spec: blueprint 03-PARSING §C)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseFastAPIProject(cwd, entryFile, pythonCmd = 'python') {
  const extractorScript = path.resolve(__dirname, 'fastapi_extract.py');
  const res = spawnSync(pythonCmd, [extractorScript, entryFile, cwd], {
    cwd,
    encoding: 'utf8',
  });

  if (res.status !== 0) {
    const errorMsg = (res.stderr || res.stdout || '').trim();
    throw new Error(`FastAPI extraction process failed: ${errorMsg}`);
  }

  try {
    const payload = JSON.parse(res.stdout.trim());
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      routes: payload.routes || [],
      skipped: payload.skipped || [],
      entryAppVars: payload.entryAppVars || [],
    };
  } catch (err) {
    throw new Error(
      `Failed to parse Python extractor output: ${err.message}. Raw output: ${res.stdout}`,
    );
  }
}

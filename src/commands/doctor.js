// commands/doctor.js
import fs from 'node:fs';
import path from 'node:path';
import { detectStack } from '../detect.js';
import { buildNegentropy, renderNegentropy } from './negentropy.js';

// Returns { healthy } so the CLI can exit non-zero on any ✗ — scripts/CI can
// gate on `sparda doctor` (E-012). Informational '·' lines never fail it.
export async function runDoctor(opts) {
  let healthy = true;
  const fail = (msg) => {
    healthy = false;
    console.log(msg);
  };

  console.log('SPARDA doctor');
  const node = process.versions.node;
  if (Number(node.split('.')[0]) >= 18) console.log(`  ✓ Node ${node} (≥18 required)`);
  else fail(`  ✗ Node ${node} (≥18 required)`);
  let stack = null;
  try {
    stack = detectStack(opts.cwd);
    console.log(
      `  ✓ Framework: ${stack.framework} — entry: ${stack.entryFile} — port: ${stack.port}`,
    );
  } catch (e) {
    fail(`  ✗ ${e.message}`);
  }
  const manifest = path.join(opts.cwd, 'sparda.json');
  let liveStats = null; // captured for the negentropy pass
  let parsedManifest = null;
  if (fs.existsSync(manifest)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      parsedManifest = m;
      const tools = Object.values(m.tools ?? {});
      console.log(
        `  ✓ sparda.json valid (${tools.length} tools, ${tools.filter((t) => t.enabled).length} enabled)`,
      );

      if (m.semantic) {
        console.log(
          `  ✓ Semantic cache: ${Object.keys(m.semantic.descriptions ?? {}).length} descriptions, ${(m.semantic.workflows ?? []).length} workflows`,
        );
      } else {
        console.log(
          '  · Semantic cache: empty — fills on first AI connection (needs MCP sampling)',
        );
      }
      const antibodies = Object.keys(m.immune?.antibodies ?? {}).length;
      console.log(
        antibodies
          ? `  ✓ Immune memory: ${antibodies} antibod${antibodies > 1 ? 'ies' : 'y'} (cached diagnoses, zero-token on recurrence)`
          : '  · Immune memory: empty — antibodies grow as new failures get diagnosed',
      );

      if (stack) {
        const headers = { 'x-sparda-key': m.localKey };
        try {
          const r = await fetch(`http://127.0.0.1:${m.port}/mcp/tools`, {
            headers,
            signal: AbortSignal.timeout(1500),
          });
          if (!r.ok) {
            fail(`  ✗ Host app on :${m.port} answered ${r.status}`);
          } else {
            const s = await fetch(`http://127.0.0.1:${m.port}/mcp/stats`, {
              headers,
              signal: AbortSignal.timeout(1500),
            })
              .then((x) => (x.ok ? x.json() : null))
              .catch(() => null);
            if (s) {
              liveStats = s;
              const totals = Object.values(s.stats ?? {}).reduce(
                (a, t) => ({ calls: a.calls + t.calls, errors: a.errors + t.errors }),
                { calls: 0, errors: 0 },
              );
              console.log(
                `  ✓ Host app reachable on :${m.port} — uptime ${s.uptimeSec}s, ${totals.calls} calls, ${totals.errors} errors`,
              );
              const quarantined = Object.entries(s.quarantine ?? {});
              if (quarantined.length) {
                for (const [tool, q] of quarantined)
                  fail(
                    `  ✗ Quarantined: ${tool} (${q.reason}) — immune system is protecting this route`,
                  );
              } else {
                console.log('  ✓ Quarantine: empty — no route is currently sick');
              }
            } else {
              console.log(
                `  ✓ Host app reachable on :${m.port}, router responding (stats unavailable — router predates v0.3, re-run \`npx sparda-mcp init\`)`,
              );
            }
          }
        } catch {
          const startCmd = m.framework === 'fastapi' ? 'fastapi dev' : 'npm run dev';
          fail(
            `  ✗ Host app on :${m.port} — NOT reachable\n      → start it with: ${startCmd}`,
          );
        }
      }
    } catch {
      fail('  ✗ sparda.json invalid JSON');
    }
  } else {
    console.log('  · sparda.json not found (run `npx sparda-mcp init`)');
  }

  // ── negentropy pass (opt-in: doctor --app) — R3.1, deterministic ─────────
  if (opts.app && parsedManifest) {
    console.log('');
    let currentRoutes = null;
    try {
      if (stack?.framework === 'express') {
        const { parseExpressProject } = await import('../parser/express.js');
        currentRoutes = parseExpressProject(opts.cwd, stack.entryFile).routes;
      } else if (stack?.framework === 'nextjs') {
        const { parseNextProject } = await import('../parser/nextjs.js');
        currentRoutes = parseNextProject(opts.cwd, stack.entryFile).routes;
      } else if (stack?.framework === 'fastapi') {
        const { parseFastAPIProject } = await import('../parser/fastapi.js');
        currentRoutes = parseFastAPIProject(
          opts.cwd,
          stack.entryFile,
          stack.pythonCmd,
        ).routes;
      }
    } catch {
      currentRoutes = null; // drift becomes "not measurable", never a guess
    }
    const result = buildNegentropy({
      manifest: parsedManifest,
      currentRoutes,
      live: liveStats,
      detectedPort: stack?.port ?? null,
      cwd: opts.cwd,
    });
    const { lines, failing } = renderNegentropy(result);
    for (const l of lines) console.log(l);
    if (failing) healthy = false;
  } else if (opts.app) {
    console.log('\n  · negentropy scan skipped — no sparda.json to compare against');
  }
  return { healthy };
}

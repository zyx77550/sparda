// commands/doctor.js
import fs from 'node:fs';
import path from 'node:path';
import { detectStack } from '../detect.js';

// Returns { healthy } so the CLI can exit non-zero on any ✗ — scripts/CI can
// gate on `sparda doctor` (E-012). Informational '·' lines never fail it.
export async function runDoctor(opts) {
  let healthy = true;
  const fail = (msg) => { healthy = false; console.log(msg); };

  console.log('SPARDA doctor');
  const node = process.versions.node;
  if (Number(node.split('.')[0]) >= 18) console.log(`  ✓ Node ${node} (≥18 required)`);
  else fail(`  ✗ Node ${node} (≥18 required)`);
  let stack = null;
  try {
    stack = detectStack(opts.cwd);
    console.log(`  ✓ Framework: ${stack.framework} — entry: ${stack.entryFile} — port: ${stack.port}`);
  } catch (e) {
    fail(`  ✗ ${e.message}`);
  }
  const manifest = path.join(opts.cwd, 'sparda.json');
  if (fs.existsSync(manifest)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const tools = Object.values(m.tools ?? {});
      console.log(`  ✓ sparda.json valid (${tools.length} tools, ${tools.filter((t) => t.enabled).length} enabled)`);

      if (m.semantic) {
        console.log(`  ✓ Semantic cache: ${Object.keys(m.semantic.descriptions ?? {}).length} descriptions, ${(m.semantic.workflows ?? []).length} workflows`);
      } else {
        console.log('  · Semantic cache: empty — fills on first AI connection (needs MCP sampling)');
      }
      const antibodies = Object.keys(m.immune?.antibodies ?? {}).length;
      console.log(antibodies
        ? `  ✓ Immune memory: ${antibodies} antibod${antibodies > 1 ? 'ies' : 'y'} (cached diagnoses, zero-token on recurrence)`
        : '  · Immune memory: empty — antibodies grow as new failures get diagnosed');

      if (stack) {
        const headers = { 'x-sparda-key': m.localKey };
        try {
          const r = await fetch(`http://127.0.0.1:${m.port}/mcp/tools`, { headers, signal: AbortSignal.timeout(1500) });
          if (!r.ok) {
            fail(`  ✗ Host app on :${m.port} answered ${r.status}`);
          } else {
            const s = await fetch(`http://127.0.0.1:${m.port}/mcp/stats`, { headers, signal: AbortSignal.timeout(1500) })
              .then((x) => (x.ok ? x.json() : null)).catch(() => null);
            if (s) {
              const totals = Object.values(s.stats ?? {}).reduce((a, t) => ({ calls: a.calls + t.calls, errors: a.errors + t.errors }), { calls: 0, errors: 0 });
              console.log(`  ✓ Host app reachable on :${m.port} — uptime ${s.uptimeSec}s, ${totals.calls} calls, ${totals.errors} errors`);
              const quarantined = Object.entries(s.quarantine ?? {});
              if (quarantined.length) {
                for (const [tool, q] of quarantined) fail(`  ✗ Quarantined: ${tool} (${q.reason}) — immune system is protecting this route`);
              } else {
                console.log('  ✓ Quarantine: empty — no route is currently sick');
              }
            } else {
              console.log(`  ✓ Host app reachable on :${m.port}, router responding (stats unavailable — router predates v0.3, re-run \`npx sparda-mcp init\`)`);
            }
          }
        } catch {
          const startCmd = m.framework === 'express' ? 'npm run dev' : 'fastapi dev';
          fail(`  ✗ Host app on :${m.port} — NOT reachable\n      → start it with: ${startCmd}`);
        }
      }
    } catch { fail('  ✗ sparda.json invalid JSON'); }
  } else {
    console.log('  · sparda.json not found (run `npx sparda-mcp init`)');
  }
  return { healthy };
}

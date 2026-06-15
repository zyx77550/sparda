// Phase 1 — close the MCP-protocol checklist (publish blocker).
import fs from 'node:fs';
import path from 'node:path';
import { Harness, sleep } from './harness.mjs';

const R = { phase: 1, steps: [] };
const rec = (id, channel, expected, got, verdict, raw) => R.steps.push({ id, channel, expected, got, verdict, raw });

const h = new Harness({ quarantineMs: 3000, eventPollMs: 500 });
const broken = path.join(h.appDir, 'broken');
try { fs.rmSync(broken, { force: true }); } catch {}

try {
  await h.startHost();
  h.startBridge();
  const init = await h.initialize();
  rec('init', '[MCP]', 'serverInfo.name contains sparda; capabilities include tools/prompts/logging',
    JSON.stringify({ serverInfo: init.result?.serverInfo, protocolVersion: init.result?.protocolVersion, capabilities: Object.keys(init.result?.capabilities ?? {}) }),
    init.result?.serverInfo?.name?.includes('sparda') ? 'PASS' : 'FAIL', init.result);

  // 1.1 tools/list + get_health
  const list = await h.request('tools/list');
  const names = list.result.tools.map((t) => t.name);
  const want = ['get_health', 'get_api_products', 'get_api_products_by_id', 'get_api_flaky', 'sparda_info', 'sparda_list_disabled_tools', 'sparda_get_context'];
  const missing = want.filter((n) => !names.includes(n));
  const leaked = names.includes('post_api_products');
  rec('1.1-list', '[MCP]', `tools listed: ${want.join(', ')}; post_api_products ABSENT (write-safety)`,
    `listed: ${names.join(', ')}`, (missing.length === 0 && !leaked) ? 'PASS' : 'FAIL', { names, missing, leaked });

  const health = await h.request('tools/call', { name: 'get_health', arguments: {} });
  const healthText = health.result?.content?.[0]?.text ?? '';
  rec('1.1-get_health', '[MCP]', 'live data from app (ok:true, products count), isError=false',
    healthText, (!health.result?.isError && healthText.includes('"ok": true')) ? 'PASS' : 'FAIL', health.result);

  // 1.2 sparda_get_context
  const ctx = await h.request('tools/call', { name: 'sparda_get_context', arguments: {} });
  const ctxText = ctx.result?.content?.[0]?.text ?? '';
  rec('1.2-context', '[MCP]', 'tools + workflows + runtime telemetry + immune memory in one call',
    ctxText.slice(0, 1200) + (ctxText.length > 1200 ? '\n…[truncated in report; full below]' : ''),
    (ctxText.includes('"framework": "express"') && ctxText.includes('"tools"') && ctxText.includes('"runtime"')) ? 'PASS' : 'FAIL', null);
  R.context_full = ctxText;

  // 1.3 sampling / semantic pass (runs on oninitialized)
  const gotSemantic = await h.waitFor(() => { try { return !!h.manifest().semantic; } catch { return false; } }, { timeoutMs: 10000 });
  const semantic = (() => { try { return h.manifest().semantic; } catch { return null; } })();
  const semanticSamplings = h.samplingRequests.filter((s) => s.kind === 'semantic');
  rec('1.3-sampling', '[MCP]', 'bridge issues sampling/createMessage for semantic pass; result cached in sparda.json (.semantic)',
    `sampling[semantic] count=${semanticSamplings.length}; cached=${gotSemantic}; descriptions=${Object.keys(semantic?.descriptions ?? {}).length}; workflows=${(semantic?.workflows ?? []).length}; source=${semantic?.source}`,
    (gotSemantic && semanticSamplings.length >= 1) ? 'PASS' : 'FAIL', semantic);

  // 1.3b cache: a fresh `dev` must NOT re-request the semantic pass
  const before = h.samplingRequests.filter((s) => s.kind === 'semantic').length;
  await h.restartBridge();
  await sleep(2500);
  const after = h.samplingRequests.filter((s) => s.kind === 'semantic').length;
  rec('1.3b-cache', '[MCP]', 'restarting the bridge does NOT re-issue the semantic sampling (cached)',
    `semantic samplings before restart=${before}, after restart=${after} (delta should be 0)`,
    (after === before) ? 'PASS' : 'FAIL', null);

  // 1.4 quarantine full cycle
  fs.writeFileSync(broken, '1');
  const fcalls = [];
  for (let i = 1; i <= 3; i++) {
    const r = await h.request('tools/call', { name: 'get_api_flaky', arguments: {} });
    fcalls.push({ call: i, isError: r.result?.isError, text: r.result?.content?.[0]?.text });
    await sleep(150);
  }
  const r4 = await h.request('tools/call', { name: 'get_api_flaky', arguments: {} });
  const r4text = r4.result?.content?.[0]?.text ?? '';
  const r4obj = safe(r4text);
  rec('1.4-quarantine', '[MCP]', '3 consecutive 5xx then 4th call = 503 quarantined, isError=true, carries retryInMs',
    `calls 1-3 isError=${fcalls.map((c) => c.isError).join(',')}; 4th: isError=${r4.result?.isError}, body=${r4text}`,
    (r4.result?.isError === true && (r4obj?.error || /quarantin/i.test(r4text)) && /retryInMs/i.test(r4text)) ? 'PASS' : 'FAIL',
    { fcalls, fourth: r4text });

  const statsQ = await h.http('/mcp/stats');
  rec('1.4-stats-quarantined', '[HTTP direct]', '/mcp/stats shows get_api_flaky in quarantine map',
    JSON.stringify(statsQ.json?.quarantine ?? statsQ.json), statsQ.json && JSON.stringify(statsQ.json).includes('get_api_flaky') ? 'PASS' : 'WARN', statsQ.json);

  // recover: delete broken, wait cooldown, half-open probe passes
  fs.rmSync(broken, { force: true });
  await sleep(3800);
  const r5 = await h.request('tools/call', { name: 'get_api_flaky', arguments: {} });
  const r5text = r5.result?.content?.[0]?.text ?? '';
  rec('1.4-halfopen-recover', '[MCP]', 'after cooldown, half-open probe passes and disarms (isError=false, ok:true)',
    `isError=${r5.result?.isError}, body=${r5text}`,
    (!r5.result?.isError && /"ok":\s*true/.test(r5text)) ? 'PASS' : 'FAIL', r5text);

  // re-armed half-open: with the route STILL failing, re-quarantine, let the cooldown
  // elapse, then a SINGLE probe 5xx (counter re-armed at 2 → 3) re-quarantines immediately.
  fs.writeFileSync(broken, '1');
  for (let i = 1; i <= 3; i++) { await h.request('tools/call', { name: 'get_api_flaky', arguments: {} }); await sleep(120); }
  await sleep(3800); // cooldown elapses, broken still present
  const probe = await h.request('tools/call', { name: 'get_api_flaky', arguments: {} }); // half-open probe reaches upstream (500), re-quarantines
  const probeText = probe.result?.content?.[0]?.text ?? '';
  const next = await h.request('tools/call', { name: 'get_api_flaky', arguments: {} }); // must be 503 again
  const nextText = next.result?.content?.[0]?.text ?? '';
  rec('1.4-rearm', '[MCP]', 'in half-open, a SINGLE probe 5xx re-quarantines immediately (cold needs 3, half-open needs 1)',
    `probe reaches upstream 5xx (isError=${probe.result?.isError}, status500=${/"upstreamStatus":\s*500/.test(probeText)}); very next call quarantined (isError=${next.result?.isError}, body=${nextText})`,
    (probe.result?.isError === true && /"upstreamStatus":\s*500/.test(probeText) && next.result?.isError === true && /retryInMs|quarantin/i.test(nextText)) ? 'PASS' : 'FAIL',
    { probe: probeText, next: nextText });
  fs.rmSync(broken, { force: true });

  const events = await h.http('/mcp/events?since=0');
  R.events_full = events.json;

  // 1.5 antibodies — the error events drive an immune diagnosis via sampling
  const gotAntibody = await h.waitFor(() => {
    try { const ab = h.manifest().immune?.antibodies ?? {}; return Object.keys(ab).some((k) => k.includes('get_api_flaky')); } catch { return false; }
  }, { timeoutMs: 10000 });
  const immune = (() => { try { return h.manifest().immune; } catch { return null; } })();
  const diagSamplings = h.samplingRequests.filter((s) => s.kind === 'diagnosis');
  rec('1.5-antibody', '[MCP]', 'a diagnostic sampling fires after failures; antibody stored bounded in sparda.json (.immune)',
    `sampling[diagnosis] count=${diagSamplings.length}; antibody stored=${gotAntibody}; antibodies=${JSON.stringify(immune?.antibodies ?? {})}`,
    (gotAntibody && diagSamplings.length >= 1) ? 'PASS' : 'FAIL', immune);

  const ctx2 = await h.request('tools/call', { name: 'sparda_get_context', arguments: {} });
  const ctx2text = ctx2.result?.content?.[0]?.text ?? '';
  rec('1.5-antibody-in-context', '[MCP]', 'the stored diagnosis surfaces in sparda_get_context (immuneMemory)',
    ctx2text.includes('immuneMemory') && /get_api_flaky/.test(ctx2text) ? 'immuneMemory present with get_api_flaky signature' : 'NOT surfaced',
    (ctx2text.includes('"immuneMemory"') && /get_api_flaky\|500/.test(ctx2text)) ? 'PASS' : 'FAIL', null);

  // stdout discipline (hard rule #2)
  rec('stdout-discipline', '[MCP]', 'NO non-JSON-RPC text on the bridge stdout (stdout = pure MCP protocol)',
    h.stdoutViolations.length === 0 ? 'clean' : `${h.stdoutViolations.length} violations: ${h.stdoutViolations.slice(0, 3).join(' | ')}`,
    h.stdoutViolations.length === 0 ? 'PASS' : 'FAIL', h.stdoutViolations.slice(0, 10));

  R.bridgeStderrSample = h.bridgeStderr.split('\n').filter(Boolean).slice(-12);
  R.samplingLog = h.samplingRequests.map((s) => ({ kind: s.kind, responsePreview: s.responseText.slice(0, 120) }));
} catch (e) {
  R.fatal = { message: e.message, stack: e.stack };
} finally {
  await h.stop();
}

R.summary = R.steps.reduce((a, s) => { a[s.verdict] = (a[s.verdict] ?? 0) + 1; return a; }, {});
process.stdout.write(JSON.stringify(R, null, 2));

function safe(t) { try { return JSON.parse(t); } catch { return null; } }

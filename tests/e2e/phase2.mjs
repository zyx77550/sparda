// Phase 2 — harden the demo app and re-validate every surface through the real MCP wire.
// Covers: 2.1 multi-param+query, 2.2 sub-router, 2.3 write verbs, 2.4 docstring defense,
// 2.5 latency antigen (+ no-false-antigen), 2.6 big payload, 2.7 concurrency,
// 2.8 naming collision, 2.9 CJS variant, 2.10 invalid input.
import { Harness, sleep } from './harness.mjs';

const R = { phase: 2, steps: [] };
const rec = (id, channel, expected, got, verdict, raw) => R.steps.push({ id, channel, expected, got, verdict, raw });
const safe = (t) => { try { return JSON.parse(t); } catch { return null; } };
const callText = (r) => r.result?.content?.[0]?.text ?? '';

// ───────────────────────────── ESM hardened app ─────────────────────────────
const h = new Harness({ quarantineMs: 3000, eventPollMs: 400 });
try {
  await h.startHost();
  h.startBridge();
  await h.initialize();

  const list = await h.request('tools/list');
  const tools = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
  const names = Object.keys(tools);

  // 2.1 multi-param + query
  const mp = tools['get_api_users_by_userid_orders_by_orderid'];
  const mpSchema = mp?.inputSchema;
  const hasBoth = mpSchema?.properties?.userId && mpSchema?.properties?.orderId
    && (mpSchema.required ?? []).includes('userId') && (mpSchema.required ?? []).includes('orderId');
  rec('2.1-schema', '[MCP]', 'multi-param tool lists userId+orderId as required string path params',
    `present=${!!mp}; props=${Object.keys(mpSchema?.properties ?? {}).join(',')}; required=${(mpSchema?.required ?? []).join(',')}`,
    hasBoth ? 'PASS' : 'FAIL', mpSchema);

  // round-trip with an accent, a space, and a slash — encoding must survive end to end
  const enc = await h.request('tools/call', { name: 'get_api_users_by_userid_orders_by_orderid',
    arguments: { userId: 'José Día', orderId: 'a/b', status: 'shipped & paid' } });
  const encObj = safe(callText(enc))?.data ?? safe(callText(enc));
  const okUser = encObj?.params?.userId === 'José Día';
  const okOrder = encObj?.params?.orderId === 'a/b';
  const okQuery = encObj?.query?.status === 'shipped & paid';
  rec('2.1-encoding', '[MCP]', 'path params (accent/space, slash→%2F) and a forwarded query param round-trip intact',
    `userId="${encObj?.params?.userId}" orderId="${encObj?.params?.orderId}" query.status="${encObj?.query?.status}"`,
    (okUser && okOrder && okQuery && !enc.result?.isError) ? 'PASS' : 'FAIL', encObj);

  // 2.2 sub-router
  const subPresent = names.includes('get_api_v2_status') && names.includes('get_api_v2_widgets_by_widgetid');
  const v2s = await h.request('tools/call', { name: 'get_api_v2_status', arguments: {} });
  const v2w = await h.request('tools/call', { name: 'get_api_v2_widgets_by_widgetid', arguments: { widgetId: 'w-42' } });
  const v2sObj = safe(callText(v2s))?.data;
  const v2wObj = safe(callText(v2w))?.data;
  rec('2.2-subrouter', '[MCP]', 'mounted sub-router (/api/v2) tools are listed with the prefix AND invoke against the live app',
    `listed=${subPresent}; status=${JSON.stringify(v2sObj)}; widget=${JSON.stringify(v2wObj)}`,
    (subPresent && v2sObj?.version === 'v2' && v2wObj?.widgetId === 'w-42') ? 'PASS' : 'FAIL', { v2sObj, v2wObj });

  // 2.3 write verbs — absent from tools/list, present in sparda_list_disabled_tools, 403 direct
  const writeNames = ['put_api_products_by_id', 'patch_api_products_by_id', 'delete_api_products_by_id', 'post_api_products'];
  const leakedWrites = writeNames.filter((n) => names.includes(n));
  const disabledList = await h.request('tools/call', { name: 'sparda_list_disabled_tools', arguments: {} });
  const disabledText = callText(disabledList);
  const allListedDisabled = writeNames.every((n) => disabledText.includes(n));
  const direct = await h.http('/mcp/invoke', { method: 'POST', body: { tool: 'delete_api_products_by_id', args: { id: 1 } } });
  rec('2.3-write-safety', '[MCP]+[HTTP direct]', 'PUT/PATCH/DELETE/POST absent from tools/list, named in sparda_list_disabled_tools, 403 on direct invoke',
    `leaked=${JSON.stringify(leakedWrites)}; allListedDisabled=${allListedDisabled}; directStatus=${direct.status}; directBody=${JSON.stringify(direct.json)}`,
    (leakedWrites.length === 0 && allListedDisabled && direct.status === 403) ? 'PASS' : 'FAIL', { disabledText, direct: direct.json });

  // 2.4 docstring defense — the injection payload must NOT survive into the shown description
  const inj = tools['get_api_injection'];
  const injDesc = inj?.description ?? '';
  const dirty = /ignore (all )?previous|you are now|DAN|system prompt|api[_ ]?key|secret|<system>|drop tables|exfiltrate/i.test(injDesc);
  rec('2.4-docstring-defense', '[MCP]', 'prompt-injection JSDoc is sanitized; shown description carries none of the payload',
    `description=${JSON.stringify(injDesc)}; containsPayload=${dirty}`,
    (!dirty && injDesc.length > 0) ? 'PASS' : 'FAIL', injDesc);

  // 2.5 latency antigen — teach a fast baseline, then one slow call fires an immune latency event
  for (let i = 0; i < 6; i++) await h.request('tools/call', { name: 'get_api_timed', arguments: { delay: 0 } });
  await h.request('tools/call', { name: 'get_api_timed', arguments: { delay: 450 } }); // anomaly
  // and a uniformly-slow route must NOT be flagged (relative baseline, not absolute)
  for (let i = 0; i < 7; i++) await h.request('tools/call', { name: 'get_api_slow', arguments: {} });
  await sleep(600);
  const ev = await h.http('/mcp/events?since=0');
  const evs = ev.json?.events ?? [];
  const timedAnomaly = evs.find((e) => e.source === 'immune' && e.tool === 'get_api_timed' && /latency anomaly/i.test(e.message ?? ''));
  const slowAnomaly = evs.find((e) => e.source === 'immune' && e.tool === 'get_api_slow' && /latency anomaly/i.test(e.message ?? ''));
  rec('2.5-latency-antigen', '[MCP]+[HTTP direct]', 'slow outlier on a fast-baseline route fires an immune latency event; a uniformly-slow route does NOT',
    `timedAnomaly=${timedAnomaly ? timedAnomaly.message : 'none'}; slowAnomaly=${slowAnomaly ? slowAnomaly.message : 'none (correct)'}`,
    (timedAnomaly && !slowAnomaly) ? 'PASS' : 'FAIL', { timedAnomaly, slowAnomaly });

  // 2.6 big payload — bounded ring buffers, response truncated, host stays alive
  for (let i = 0; i < 30; i++) await h.request('tools/call', { name: 'get_api_big', arguments: {} });
  const bigOnce = await h.request('tools/call', { name: 'get_api_big', arguments: {} });
  const bigText = callText(bigOnce);
  const statsBig = await h.http('/mcp/stats');
  const evCount = (await h.http('/mcp/events?since=0')).json?.events?.length ?? 0;
  const stillAlive = (await h.http('/mcp/stats')).status === 200;
  rec('2.6-big-payload', '[MCP]+[HTTP direct]', '~2MB payload ×31: MCP text truncated, events buffer bounded ≤100, host alive, stats counts calls',
    `mcpTruncated=${/truncated/.test(bigText)}; eventsLen=${evCount} (cap 100); hostAlive=${stillAlive}; big.calls=${statsBig.json?.stats?.get_api_big?.calls}`,
    (/truncated/.test(bigText) && evCount <= 100 && stillAlive && (statsBig.json?.stats?.get_api_big?.calls ?? 0) >= 31) ? 'PASS' : 'FAIL', null);

  // 2.7 concurrency — 20 parallel invokes, all succeed, stats accounts for exactly 20
  const before = (await h.http('/mcp/stats')).json?.stats?.get_api_products?.calls ?? 0;
  const conc = await Promise.all(Array.from({ length: 20 }, () => h.request('tools/call', { name: 'get_api_products', arguments: {} })));
  const allOk = conc.every((r) => !r.result?.isError && /Espresso/.test(callText(r)));
  const after = (await h.http('/mcp/stats')).json?.stats?.get_api_products?.calls ?? 0;
  rec('2.7-concurrency', '[MCP]+[HTTP direct]', '20 parallel tools/call all succeed and stats increments by exactly 20 (no race corruption)',
    `allOk=${allOk}; calls before=${before} after=${after} (Δ=${after - before})`,
    (allOk && (after - before) === 20) ? 'PASS' : 'FAIL', null);

  // 2.8 naming collision — two paths normalize to the same name; both exist distinctly and both invoke
  const cA = await h.request('tools/call', { name: 'get_api_products_by_id', arguments: {} });
  const cB = await h.request('tools/call', { name: 'get_api_products_by_id_2', arguments: { id: 1 } });
  const cAObj = safe(callText(cA))?.data;
  const cBObj = safe(callText(cB))?.data;
  rec('2.8-collision', '[MCP]', 'colliding tool names disambiguated (_2 suffix); both distinct tools invoke their own route',
    `literal(get_api_products_by_id)=${JSON.stringify(cAObj)}; param(get_api_products_by_id_2)=${JSON.stringify(cBObj)}`,
    (cAObj?.collisionRoute === true && cBObj?.name === 'Espresso') ? 'PASS' : 'FAIL', { cAObj, cBObj });

  // 2.10 invalid input — missing required path param is rejected (400), not silently dropped
  const bad = await h.request('tools/call', { name: 'get_api_users_by_userid_orders_by_orderid', arguments: { userId: 'x' } });
  const badText = callText(bad);
  rec('2.10-invalid-input', '[MCP]', 'missing required path param → isError with a "missing path param" message (no malformed upstream call)',
    `isError=${bad.result?.isError}; body=${badText}`,
    (bad.result?.isError === true && /missing path param/i.test(badText)) ? 'PASS' : 'FAIL', badText);

  R.esm_tools = names;
} catch (e) {
  R.fatal_esm = { message: e.message, stack: e.stack };
} finally {
  await h.stop();
}

// ───────────────────────────── 2.9 CJS variant ─────────────────────────────
await sleep(500);
const hc = new Harness({ appDir: 'C:/Users/zakwi/Desktop/sparda-demo-cjs', entry: 'server.js', quarantineMs: 3000, eventPollMs: 400 });
try {
  await hc.startHost();
  hc.startBridge();
  const init = await hc.initialize();
  const list = await hc.request('tools/list');
  const names = list.result.tools.map((t) => t.name);
  const health = await hc.request('tools/call', { name: 'get_health', arguments: {} });
  const healthObj = safe(callText(health))?.data;
  const item = await hc.request('tools/call', { name: 'get_api_items_by_id', arguments: { id: 1 } });
  const itemObj = safe(callText(item))?.data;
  rec('2.9-cjs-variant', '[MCP]', 'CommonJS app (require/module.exports) generates a CJS router and serves tools over MCP',
    `serverInfo=${init.result?.serverInfo?.name}; tools=${names.join(',')}; health=${JSON.stringify(healthObj)}; item=${JSON.stringify(itemObj)}`,
    (init.result?.serverInfo?.name?.includes('sparda') && names.includes('get_api_items_by_id')
      && healthObj?.runtime === 'cjs' && itemObj?.label === 'alpha') ? 'PASS' : 'FAIL', { names, healthObj, itemObj });
  rec('2.9-stdout-discipline', '[MCP]', 'CJS bridge keeps stdout pure JSON-RPC (no require() noise leaked)',
    hc.stdoutViolations.length === 0 ? 'clean' : `${hc.stdoutViolations.length} violations`,
    hc.stdoutViolations.length === 0 ? 'PASS' : 'FAIL', hc.stdoutViolations.slice(0, 5));
  R.cjs_stderr = hc.bridgeStderr.split('\n').filter(Boolean).slice(-6);
} catch (e) {
  R.fatal_cjs = { message: e.message, stack: e.stack };
} finally {
  await hc.stop();
}

R.summary = R.steps.reduce((a, s) => { a[s.verdict] = (a[s.verdict] ?? 0) + 1; return a; }, {});
process.stdout.write(JSON.stringify(R, null, 2));

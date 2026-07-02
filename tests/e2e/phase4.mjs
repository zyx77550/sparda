// Phase 4 — fixture-based real-client E2E for the post-0.3.0 organs that phase1-3
// no longer cover (they are pinned to the deleted `sparda-demo-app`). Runs against
// `tests/fixtures/express-demo`: protocol smoke, the recycling flywheel (R4.3), and
// Labs circuit crystallization (R2.2). Manual run; prints a JSON verdict to stdout,
// human logs to stderr — same contract as phase1-3.
//
// Prereq: SPARDA_E2E_APP points at a prepared copy of express-demo with `express`
// installed, `init` already run, and sparda.json carrying labs.recordSequences=true.
//   (see docs/E2E-RUNBOOK.md §0 for the one-time prep)
import { Harness, sleep } from './harness.mjs';

const R = { phase: 4, steps: [] };
const rec = (id, expected, got, verdict, raw) =>
  R.steps.push({ id, expected, got, verdict, ...(raw !== undefined ? { raw } : {}) });
const txt = (r) => r?.result?.content?.[0]?.text ?? '';
const J = (r) => {
  try {
    return JSON.parse(txt(r));
  } catch {
    return null;
  }
};

const h = new Harness({ entry: 'src/app.js', eventPollMs: 300 });

try {
  await h.startHost();
  h.startBridge();
  await h.initialize();

  // 4.1 — protocol: reads+meta listed, write tools hidden, dynamic route skipped
  const list = await h.request('tools/list');
  const names = list.result.tools.map((t) => t.name);
  const reads = ['get_health', 'get_api_prospects', 'get_api_users_by_id'].every((n) => names.includes(n));
  const meta = ['sparda_info', 'sparda_get_context', 'sparda_confirm', 'sparda_list_disabled_tools'].every((n) => names.includes(n));
  const writeHidden = !names.includes('post_api_users') && !names.includes('delete_api_prospects_by_id');
  const noDynamic = !names.some((n) => n.includes('meta')); // GET /v2/meta is dynamic -> must be skipped
  rec('4.1-list', 'reads+meta listed; write tools hidden (write-safety); /v2/meta skipped',
    JSON.stringify(names), reads && meta && writeHidden && noDynamic ? 'PASS' : 'FAIL',
    { reads, meta, writeHidden, noDynamic });

  // annotations on a GET tool
  const a = (list.result.tools.find((t) => t.name === 'get_api_prospects') || {}).annotations ?? {};
  rec('4.1-annotations', 'get_api_prospects -> readOnlyHint:true, idempotentHint:true',
    JSON.stringify(a), a.readOnlyHint === true && a.idempotentHint === true ? 'PASS' : 'FAIL');

  // 4.2 — live read through the real MCP wire
  const r1 = await h.request('tools/call', { name: 'get_api_prospects', arguments: {} });
  rec('4.2-live-read', 'live host data (count:3), isError:false',
    txt(r1).slice(0, 160), !r1.result?.isError && txt(r1).includes('"count": 3') ? 'PASS' : 'FAIL');

  // 4.3 — recycling flywheel: hammer an identical read, expect served-from-memory
  const ctx0 = J(await h.request('tools/call', { name: 'sparda_get_context', arguments: {} }));
  const served0 = ctx0?.recycling?.flywheel?.servedFromMemory ?? 0;
  for (let i = 0; i < 6; i++) await h.request('tools/call', { name: 'get_api_prospects', arguments: {} });
  let served1 = served0;
  let armed1 = 0;
  let ctx1 = null;
  await h.waitFor(
    async () => {
      ctx1 = J(await h.request('tools/call', { name: 'sparda_get_context', arguments: {} }));
      served1 = ctx1?.recycling?.flywheel?.servedFromMemory ?? 0;
      armed1 = ctx1?.recycling?.flywheel?.armed ?? 0;
      return armed1 >= 1 || served1 > served0;
    },
    { timeoutMs: 9000, intervalMs: 400 },
  );
  rec('4.3-flywheel', 'after >=3 identical reads: armed>=1 and/or servedFromMemory grows (host call skipped)',
    JSON.stringify({ served0, served1, armed1 }), armed1 >= 1 || served1 > served0 ? 'PASS' : 'FAIL',
    { purity: ctx1?.runtime?.purity ?? null });

  // 4.4 — crystallization: prospects -> users(id:2) observed 3x => composite tool appears.
  // id must be a NUMBER: a 1-char string id is rejected by the value matcher; a number
  // under an `id` key is always retained (condenser candidateValue rule).
  for (let i = 0; i < 3; i++) {
    await h.request('tools/call', { name: 'get_api_prospects', arguments: {} });
    await h.request('tools/call', { name: 'get_api_users_by_id', arguments: { id: 2 } });
    await sleep(450); // let the idle harvester analyze between duos
  }
  let composite = null;
  await h.waitFor(
    async () => {
      const l = await h.request('tools/list');
      composite = l.result.tools.find((t) => /\[Labs circuit/.test(t.description || ''));
      return !!composite;
    },
    { timeoutMs: 12000, intervalMs: 500 },
  );
  const info = J(await h.request('tools/call', { name: 'sparda_info', arguments: {} }));
  rec('4.4-crystallization', 'a [Labs circuit xN] composite tool appears after 3 observations',
    composite ? `${composite.name} :: ${composite.description}` : '(none)', composite ? 'PASS' : 'FAIL',
    { circuits_observed: info?.circuits_observed, composite_tools: info?.composite_tools });

  // run the crystallized composite end-to-end
  if (composite) {
    const cr = await h.request('tools/call', { name: composite.name, arguments: {} });
    rec('4.4-run-composite', 'composite runs the whole chain live, isError:false',
      txt(cr).slice(0, 200), !cr.result?.isError ? 'PASS' : 'FAIL');
  }

  // stdout discipline (hard rule #2): the bridge stdout carried only JSON-RPC
  rec('4.x-stdout', 'no non-JSON line leaked on the bridge stdout (logs go to stderr)',
    `violations=${h.stdoutViolations.length}`, h.stdoutViolations.length === 0 ? 'PASS' : 'FAIL',
    h.stdoutViolations.slice(0, 3));
} catch (e) {
  R.error = String(e?.stack || e);
} finally {
  await h.stop();
}

R.summary = R.steps.reduce((s, x) => ((s[x.verdict] = (s[x.verdict] || 0) + 1), s), {});
R.verdict = !R.error && R.steps.every((s) => s.verdict === 'PASS') ? 'ALL PASS' : 'SEE FAILURES';
process.stdout.write(JSON.stringify(R, null, 2) + '\n');
process.exit(R.verdict === 'ALL PASS' ? 0 : 1);

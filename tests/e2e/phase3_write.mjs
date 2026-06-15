// Phase 3.3 — write opt-in + native elicitation confirmation + proof-after-write.
// post_api_products was opted-in (enabled:true) and re-init'd. This exercises the
// human-in-the-loop write path over the real MCP wire: the server ISSUES an
// elicitation/create request, the client answers, and on accept SPARDA reads the
// resource back so the AI sees the effect of its own write.
import { Harness, sleep } from './harness.mjs';

const R = { phase: '3.3', steps: [] };
const rec = (id, channel, expected, got, verdict, raw) => R.steps.push({ id, channel, expected, got, verdict, raw });
const safe = (t) => { try { return JSON.parse(t); } catch { return null; } };
const callText = (r) => r.result?.content?.[0]?.text ?? '';

const h = new Harness({ quarantineMs: 3000, eventPollMs: 400 });
try {
  await h.startHost();
  h.startBridge();
  await h.initialize();

  const list = await h.request('tools/list');
  const names = list.result.tools.map((t) => t.name);
  rec('3.3-optin-listed', '[MCP]', 'after opt-in (enabled:true) + re-init, post_api_products IS now listed in tools/list',
    `present=${names.includes('post_api_products')}; tools=${names.length}`,
    names.includes('post_api_products') ? 'PASS' : 'FAIL', names);

  // baseline product count (read-only)
  const before = safe(callText(await h.request('tools/call', { name: 'get_api_products', arguments: {} })))?.data ?? [];

  // 3.3a ACCEPT — elicitation fires, client confirms, write executes, proof read-back returned
  h.elicitationResponder = () => ({ action: 'accept', content: { confirm: true } });
  const elicBefore = h.elicitationRequests.length;
  const accepted = await h.request('tools/call', { name: 'post_api_products', arguments: { body: { name: 'Latte', price: 5 } } });
  const accObj = safe(callText(accepted));
  const elicFired = h.elicitationRequests.length > elicBefore;
  const elicMsg = h.elicitationRequests.at(-1)?.message ?? '';
  const proofState = accObj?.proof?.state;
  const proofHasLatte = Array.isArray(proofState) && proofState.some((p) => p.name === 'Latte');
  rec('3.3a-write-accept', '[MCP]', 'server issues elicitation/create; on accept the POST runs (201) and proof-after-write reads the resource back showing the new row',
    `elicitationFired=${elicFired}; msg="${elicMsg}"; isError=${accepted.result?.isError}; upstreamStatus=${accObj?.upstreamStatus}; proof.readBack=${accObj?.proof?.readBack}; proofHasLatte=${proofHasLatte}`,
    (elicFired && !accepted.result?.isError && accObj?.upstreamStatus === 201 && proofHasLatte) ? 'PASS' : 'FAIL', accObj);

  // 3.3b DECLINE — elicitation fires, client declines, write is NOT executed
  h.elicitationResponder = () => ({ action: 'decline' });
  const elicBefore2 = h.elicitationRequests.length;
  const declined = await h.request('tools/call', { name: 'post_api_products', arguments: { body: { name: 'ShouldNotExist', price: 99 } } });
  const decText = callText(declined);
  const elicFired2 = h.elicitationRequests.length > elicBefore2;
  const after = safe(callText(await h.request('tools/call', { name: 'get_api_products', arguments: {} })))?.data ?? [];
  const notAdded = !after.some((p) => p.name === 'ShouldNotExist');
  rec('3.3b-write-decline', '[MCP]', 'on decline the write is NOT executed and the resource is unchanged',
    `elicitationFired=${elicFired2}; isError=${declined.result?.isError}; body="${decText}"; productNotAdded=${notAdded}; countBefore=${before.length} countAfter=${after.length}`,
    (elicFired2 && declined.result?.isError === true && /declined/i.test(decText) && notAdded) ? 'PASS' : 'FAIL', { decText, after });

  R.elicitationLog = h.elicitationRequests.map((e) => ({ message: e.message, answer: e.answer }));
} catch (e) {
  R.fatal = { message: e.message, stack: e.stack };
} finally {
  await h.stop();
}

R.summary = R.steps.reduce((a, s) => { a[s.verdict] = (a[s.verdict] ?? 0) + 1; return a; }, {});
process.stdout.write(JSON.stringify(R, null, 2));

// Self-contained smoke test for the patched SPARDA router.
// Usage:  node sparda_selftest.cjs   (expects express-router.txt next to it, and `npm i express`)
const fs = require('fs');
const express = require('express');
const PORT = Number(process.env.TEST_PORT || 4399);

// --- render the template exactly like src/generator/express.js (CJS/JS variant) ---
const tools = {
  get_user: { method: 'GET', path: '/users/:id', pathParams: ['id'], enabled: true },
  add_credits: {
    method: 'POST',
    path: '/users/:id/credits',
    pathParams: ['id'],
    enabled: true,
  },
  wipe_user: { method: 'DELETE', path: '/users/:id', pathParams: ['id'], enabled: true },
};
const policies = { reads: 'allow', writes: 'require_human', deletes: 'block' };
let tpl = fs
  .readFileSync(
    require('path').join(__dirname, '..', 'templates', 'express-router.txt'),
    'utf8',
  )
  .replace('__IMPORT_LINE__', "const express = require('express');")
  .replace('__SPARDING_POLICIES__', JSON.stringify(policies))
  .replace(
    '__ROUTER_DECL__',
    'const spardaRouter = express.Router();\nmodule.exports = { spardaRouter };',
  )
  .replace('__JSON_MW__', 'express.json()')
  .replace('__TOOLS_JSON__', JSON.stringify(tools, null, 2))
  .replace('__LOCAL_KEY__', 'testkey')
  .replace('__PORT__', String(PORT))
  .replace(/__REQ_TYPE__/g, '')
  .replace(/__RES_TYPE__/g, '')
  .replace(/__NEXT_TYPE__/g, '')
  .replace(/__STATS_TYPE__/g, '')
  .replace(/__EVENTS_TYPE__/g, '')
  .replace(/__ANY_TYPE__/g, '');
const left = tpl.match(/__[A-Z_]+__/g);
if (left) {
  console.error('LEFTOVER PLACEHOLDERS:', left);
  process.exit(1);
}
const tmp = require('path').join(__dirname, '.sparda_selftest_router.cjs');
fs.writeFileSync(tmp, tpl);
const { spardaRouter } = require(tmp);

// --- fake host (route-scoped json, no global parser) ---
const app = express();
const DB = { zak: { id: 'zak', credits: 100 } };
app.get('/users/:id', (req, res) =>
  res.json(DB[req.params.id] || { id: req.params.id, credits: 0 }),
);
app.post('/users/:id/credits', express.json(), (req, res) => {
  const u = DB[req.params.id] || (DB[req.params.id] = { id: req.params.id, credits: 0 });
  u.credits += (req.body && req.body.delta) || 0;
  res.json({ id: u.id, credits: u.credits, added: (req.body && req.body.delta) || 0 });
});
app.use('/mcp', spardaRouter);

const H = { 'content-type': 'application/json', 'x-sparda-key': 'testkey' };
const B = `http://127.0.0.1:${PORT}/mcp`;
let pass = 0,
  fail = 0;
const check = (n, c, d) => {
  c
    ? (pass++, console.log(`  PASS  ${n}`))
    : (fail++, console.log(`  FAIL  ${n}  -> ${d}`));
};

async function run() {
  {
    const r = await fetch(`${B}/invoke`, {
      method: 'POST',
      headers: H,
      body: '{"tool":"get_user","args":null}',
    });
    const ct = r.headers.get('content-type') || '';
    const j = await r.json().catch(() => null);
    check(
      'BUG#1 args:null -> 400 JSON',
      r.status === 400 && ct.includes('json') && j && j.error,
      `status=${r.status} ct=${ct}`,
    );
  }

  {
    const r = await fetch(`${B}/invoke`, {
      method: 'POST',
      headers: H,
      body: '{bad json',
    });
    const ct = r.headers.get('content-type') || '';
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    const noStack = !/at \w|\.js:\d/.test(txt);
    check(
      'BUG#2 malformed JSON -> 400 JSON, no stack',
      r.status === 400 && ct.includes('json') && j && j.error && noStack,
      `status=${r.status} ct=${ct} stack=${!noStack}`,
    );
  }

  {
    const r = await fetch(`${B}/invoke`, { method: 'GET', headers: H });
    const ct = r.headers.get('content-type') || '';
    const j = await r.json().catch(() => null);
    check(
      'BUG#5 GET /invoke -> 405 JSON',
      r.status === 405 && ct.includes('json') && j && j.error,
      `status=${r.status} ct=${ct}`,
    );
  }

  {
    const r = await fetch(`${B}/invoke`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ tool: 'get_user', args: { id: 'zak' } }),
    });
    const j = await r.json();
    check(
      'read (allow) executes',
      r.status === 200 && j.data && j.data.credits === 100,
      JSON.stringify(j),
    );
  }

  let token = null;
  {
    const before = DB.zak.credits;
    const r = await fetch(`${B}/invoke`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tool: 'add_credits',
        args: { id: 'zak', body: { delta: 50 } },
      }),
    });
    const j = await r.json();
    token = j.confirm;
    const notExec = DB.zak.credits === before;
    check(
      'BUG#3 require_human -> 202, NOT executed',
      r.status === 202 && j.status === 'awaiting_confirmation' && token && notExec,
      `status=${r.status} executed=${!notExec}`,
    );
  }

  {
    const before = DB.zak.credits;
    const r = await fetch(`${B}/invoke/confirm`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ confirm: token }),
    });
    const j = await r.json();
    check(
      'confirm with token executes',
      r.status === 200 &&
        j.data &&
        DB.zak.credits === before + 50 &&
        j.data.credits === 150,
      `status=${r.status} ${JSON.stringify(j)}`,
    );
  }

  {
    const r = await fetch(`${B}/invoke/confirm`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ confirm: token }),
    });
    const j = await r.json();
    check(
      'token single-use (replay -> 409)',
      r.status === 409 && j.error,
      `status=${r.status}`,
    );
  }

  {
    const r = await fetch(`${B}/invoke/confirm`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ confirm: 'cfm_nope' }),
    });
    const j = await r.json();
    check('bad token -> 409 JSON', r.status === 409 && j.error, `status=${r.status}`);
  }

  {
    const r = await fetch(`${B}/invoke`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ tool: 'wipe_user', args: { id: 'zak' } }),
    });
    const j = await r.json();
    check(
      'delete policy=block still blocks (403)',
      r.status === 403 && j.spardingProof && j.spardingProof.decision === 'block',
      `status=${r.status}`,
    );
  }

  {
    const r = await fetch(`${B}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => null);
    check(
      'auth: no key -> 401 JSON',
      r.status === 401 && j && j.error,
      `status=${r.status}`,
    );
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `  (${fail} FAILED)` : ''}`);
  try {
    fs.unlinkSync(tmp);
  } catch {}
  // exit cleanly: drop the exit code, destroy keep-alive sockets (undici's fetch pool keeps
  // them open) and close the server, then let the loop drain naturally. A bare process.exit()
  // here races libuv's handle teardown on Windows (UV_HANDLE_CLOSING assertion).
  process.exitCode = fail ? 1 : 0;
  server.closeAllConnections?.();
  server.close();
}
const server = app.listen(PORT, () =>
  run().catch((e) => {
    console.error(e);
    process.exitCode = 2;
    server.closeAllConnections?.();
    server.close();
  }),
);

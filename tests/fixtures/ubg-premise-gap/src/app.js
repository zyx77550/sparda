// The premise corpus. Two routes any AST can read, and two that NO static analysis
// can ever reach: their table is data, materialised at boot. The framework builds
// all four. Only the running app can say so — which is the whole point of the
// premise verifier: the oracle is not the analyser.
const express = require('express');
const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/notes', (req, res) => res.json({ ok: true }));

const TABLE = JSON.parse(
  process.env.SPARDA_FIXTURE_ROUTES ||
    '[["post","/admin/wipe"],["delete","/admin/purge"]]',
);
for (const [verb, p] of TABLE) {
  app[verb](p, (req, res) => res.json({ done: p }));
}

app.listen(0);
module.exports = app;

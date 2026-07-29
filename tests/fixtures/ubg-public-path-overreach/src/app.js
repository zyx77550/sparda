// Fixture for the public-by-design OVER-REACH class (breaker-found).
// The `expectedPublic` re-label (apocalypse.js) is EVIDENCE-FREE path-convention triage. Its token
// list contains generic verbs — `register`, `webhook`/`hook` — that ALSO name authenticated
// management operations. A route that mutates state under an authenticated namespace and is
// UNGUARDED is a real critical; re-labeling it "public-by-design" would hide it (the change-password
// hole, one alternative over). This fixture pins BOTH directions.
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

// CONTROL — a genuine public signup. No auth guard is correct here; the re-label to an
// info advisory ("confirm intent") is the sanctioned behaviour and must SURVIVE the fix.
app.post('/register', async (req, res) => {
  await db.query('INSERT INTO users (email) VALUES ($1)', [req.body.email]);
  res.status(201).json({ ok: true });
});

// HOLE #1 — binds a 2FA authenticator to an account whose id comes from the request body.
// Session-only in reality; unguarded here (account takeover). MUST stay critical, never
// re-labeled public-by-design via the `register` token.
app.post('/account/2fa/register', async (req, res) => {
  await db.query('INSERT INTO authenticators (user_id, secret) VALUES ($1, $2)', [
    req.body.userId,
    req.body.secret,
  ]);
  res.status(201).json({ ok: true });
});

// HOLE #2 — creating a webhook SUBSCRIPTION is authenticated management (SSRF/abuse if open),
// distinct from a signed webhook RECEIVER. Unguarded here. MUST stay critical.
app.post('/api/webhooks', async (req, res) => {
  await db.query('INSERT INTO webhooks (url) VALUES ($1)', [req.body.url]);
  res.status(201).json({ ok: true });
});

app.listen(4610);
module.exports = app;

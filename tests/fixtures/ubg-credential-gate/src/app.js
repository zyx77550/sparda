const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// family C: stored-token lookup gates the mutation (throws when absent) → advisory, not critical
app.post('/auth/reset-password', async (req, res) => {
  const found = await prisma.passwordResetToken.findFirst({
    where: { token: req.body.token, expires: { gte: new Date() } },
  });
  if (!found) throw new Error('reset token not found or expired');
  await prisma.user.update({ where: { email: found.identifier }, data: { password: req.body.password } });
  res.end();
});

// family B: a verify call + 4xx refusal → advisory, not critical
app.post('/unsubscribe', async (req, res) => {
  const email = verifyUnsubscribeToken(req.body.token);
  if (!email) return res.status(400).json({ error: 'invalid token' });
  await prisma.user.update({ where: { email }, data: { subscribed: false } });
  res.end();
});

// no credential at all: a genuinely unguarded mutation → stays CRITICAL
app.post('/naked', async (req, res) => {
  await prisma.user.update({ where: { email: req.body.email }, data: { plan: req.body.plan } });
  res.end();
});

// token-table read but NO refusal shape anywhere → stays CRITICAL (reading is not gating)
app.post('/reads-token-no-gate', async (req, res) => {
  const t = await prisma.passwordResetToken.findFirst({ where: { token: req.body.token } });
  await prisma.user.update({ where: { email: req.body.email }, data: { seen: t } });
  res.end();
});

// family A (API key) THROUGH THE CALL GRAPH: the refusal lives in a delegated helper reached by a
// call, not on the middleware chain, and it refuses with a NAMED helper (`unauthorizedResponse`),
// not a literal res.status(401). Exercises: apikey token family + named-refusal detector + the
// call-graph signal propagation. Downgrades to advisory, never critical.
app.get('/api/management/me', async (req, res) => {
  const key = await authenticateApiKey(req, res);
  if (!key) return; // helper already refused
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  res.json({ ok: true });
});
async function authenticateApiKey(req, res) {
  const key = await prisma.apiKey.findUnique({ where: { hashedKey: req.headers['x-api-key'] } });
  if (!key) {
    unauthorizedResponse(res);
    return null;
  }
  return key;
}

// family E (first-run) THROUGH THE CALL GRAPH: a bootstrap-shaped path whose refusal (throw when an
// admin already exists) lives in a delegated service helper. Downgrades to advisory.
app.post('/setup/admin', async (req, res) => {
  await createFirstAdmin(req.body);
  res.end();
});
async function createFirstAdmin(dto) {
  const existing = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (existing) throw new Error('the server already has an admin');
  await prisma.user.create({ data: { email: dto.email, role: 'admin' } });
}

// soundness negative: a bootstrap-shaped path that reads identity but has NO refusal shape anywhere
// (no throw, no 4xx, no named-refusal) must STAY CRITICAL — a setup route still has to prove its gate.
app.post('/setup/import', async (req, res) => {
  await prisma.user.findFirst({ where: { email: req.body.email } });
  await prisma.user.update({ where: { email: req.body.email }, data: { seen: true } });
  res.end();
});

// Class 1 (public-by-design): a login route with NO modeled gate — re-labeled EXPECTED_PUBLIC (info),
// never critical, never hidden. Convention-based triage by path signature, not proof of a gate.
app.post('/auth/login', async (req, res) => {
  await prisma.user.update({ where: { email: req.body.email }, data: { seen: true } });
  res.end();
});

// soundness: an auth-ADJACENT route that is NOT public by convention — change-password needs a
// session — must STAY critical. The signature list is deliberately precise, never a `/auth/**` blanket.
app.post('/account/change-password', async (req, res) => {
  await prisma.user.update({ where: { email: req.body.email }, data: { password: req.body.password } });
  res.end();
});

app.listen(3001);
module.exports = app;

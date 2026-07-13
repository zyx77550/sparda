const express = require('express');
const app = express();
app.use(express.json());

const prisma = { user: { create: async () => null } };

// a DISABLED auth guard — named like a guard, but a pure unconditional pass-through.
// It guards nothing; SPARDA must NOT credit it.
function requireAuth(req, res, next) {
  next();
}

// a REAL guard — it actually denies (a deny path is visible → verified).
function realAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).end();
  next();
}

// guarded only by the no-op → a genuine unguarded mutation
app.post('/leaky', requireAuth, async (req, res) => {
  await prisma.user.create({ data: req.body });
  res.status(201).json({ ok: true });
});

// guarded by a real, verified guard → clean
app.post('/safe', realAuth, async (req, res) => {
  await prisma.user.create({ data: req.body });
  res.status(201).json({ ok: true });
});

app.listen(3000);
module.exports = app;

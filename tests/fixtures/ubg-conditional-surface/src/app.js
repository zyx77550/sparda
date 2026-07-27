// Conditional-surface fixture: every registration behind a control-flow
// bifurcation (if, switch, ternary, short-circuit) exists in only PART of the
// executions — the analysis must declare the doubt, never assume 100% activation.
const express = require('express');
const app = express();
app.use(express.json());

const prisma = {
  note: { create: async () => null },
};

function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// conditional GLOBAL middleware — its protection cannot be assumed everywhere
if (process.env.ENABLE_AUTH) {
  app.use(requireAuth);
}

// switch bifurcation — the route exists only in admin mode
switch (process.env.MODE) {
  case 'admin':
    app.post('/admin/reset', async (req, res) => {
      await prisma.note.create({ data: { reset: true } });
      res.json({ ok: true });
    });
    break;
}

// ternary and short-circuit registrations
process.env.DEBUG
  ? app.get('/debug', (req, res) => res.json({ debug: true }))
  : null;
process.env.METRICS && app.get('/metrics', (req, res) => res.json({ up: 1 }));

// unconditional, explicitly guarded — the stable part of the surface
app.post('/notes', requireAuth, async (req, res) => {
  await prisma.note.create({ data: { text: req.body.text } });
  res.status(201).json({ ok: true });
});

app.listen(4701);
module.exports = app;

// Sequential-order fixture: Express reads this file top-to-bottom, so the
// requireAuth registered mid-file protects ONLY what is declared after it.
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

// declared BEFORE app.use(requireAuth) — auth never runs for this route
app.post('/before', async (req, res) => {
  await prisma.note.create({ data: { text: req.body.text } });
  res.status(201).json({ ok: true });
});

// router mounted BEFORE the auth middleware — its whole subtree is unprotected
app.use('/pub', require('./routes/pub'));

app.use(requireAuth);

// declared AFTER — properly guarded
app.post('/after', async (req, res) => {
  await prisma.note.create({ data: { text: req.body.text } });
  res.status(201).json({ ok: true });
});

// router mounted AFTER — its whole subtree inherits the guard
app.use('/priv', require('./routes/priv'));

app.listen(4700);
module.exports = app;

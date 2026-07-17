// Taint enrichment fixture — request data flowing into a write is a TAG on an existing
// UNGUARDED_MUTATION, never a finding of its own. Three routes pin the behavior.
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
app.use(express.json());
const prisma = new PrismaClient();

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// open + tainted: user input flows straight into the write → UNGUARDED_MUTATION, tainted
app.post('/open-tainted', async (req, res) => {
  await prisma.thing.create({ data: req.body });
  res.status(201).json({ ok: true });
});

// open + literal: unguarded, but the payload is a constant → UNGUARDED_MUTATION, NOT tainted
app.post('/open-literal', async (req, res) => {
  await prisma.setting.create({ data: { flag: 'on' } });
  res.status(201).json({ ok: true });
});

// guarded + tainted: a real guard denies → NO finding at all, so no tag to argue about
app.post('/secure-tainted', requireAuth, async (req, res) => {
  await prisma.thing.create({ data: req.body });
  res.status(201).json({ ok: true });
});

app.listen(4601);
module.exports = app;

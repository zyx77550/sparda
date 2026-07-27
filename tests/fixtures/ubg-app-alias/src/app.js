// Z2 corpus — one line of aliasing used to erase a route from the graph while the
// app still read PROVEN at 100% coverage. Express does not care what the object is
// called; neither may the extractor.
const express = require('express');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
app.use(express.json());

const noteSchema = z.object({ text: z.string().min(1) });

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.post('/notes', requireAuth, async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid' });
  await prisma.note.create({ data: { text: parsed.data.text } });
  res.status(201).json({ ok: true });
});

// the alias — and an alias OF the alias, to prove the fixpoint
const api = app;
const api2 = api;

api.post('/admin/wipe', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ wiped: true });
});

api2.delete('/admin/purge', async (req, res) => {
  await prisma.user.deleteMany({});
  res.json({ purged: true });
});

// a router alias too — in its own file, so the mount prefix applies
app.use('/mounted', require('./sub'));

app.listen(4801);
module.exports = app;

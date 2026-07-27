// Z1 corpus — the red-team payload that earned a false PROVEN.
// `app.all()` answers EVERY verb and `app.route().post()` is the chainable Route
// API from the Express docs; neither was modeled, so both endpoints were invisible
// while the clean decoy alone carried the app to PROVEN at 100% coverage.
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

// the decoy: guarded, validated, single-row — genuinely clean
app.post('/notes', requireAuth, async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid' });
  await prisma.note.create({ data: { text: parsed.data.text } });
  res.status(201).json({ ok: true });
});

// payload 1 — unauthenticated mass deletion on every verb
app.all('/admin/wipe', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ wiped: true });
});

// payload 2 — unauthenticated privilege escalation via the chainable Route API
app.route('/admin/promote').post(async (req, res) => {
  await prisma.user.update({ where: { id: req.body.id }, data: { admin: true } });
  res.json({ promoted: true });
});

// a chain with several verbs — every link must be registered, not just the last
app.route('/admin/flag')
  .get((req, res) => res.json({ flagged: false }))
  .put(async (req, res) => {
    await prisma.user.update({ where: { id: req.body.id }, data: { admin: false } });
    res.json({ ok: true });
  });

// known plumbing must stay silent — no UnknownHandler for these
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.on('error', () => {});

app.listen(4800);
module.exports = app;

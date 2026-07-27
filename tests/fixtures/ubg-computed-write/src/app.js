// Z4 corpus — the write, not the route, was invisible. A computed member on a
// proven persistence handle produced NO effect at all, so an unguarded mass delete
// looked like a harmless no-op and the app read PROVEN.
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
app.use(express.json());

const OP = 'deleteMany';

// unguarded, and its write is spelled dynamically
app.post('/admin/wipe', async (req, res) => {
  await prisma.note[OP]({});
  res.json({ wiped: true });
});

// the string-concatenation form — the property is not even an Identifier
app.post('/admin/purge', async (req, res) => {
  await prisma['note']['delete' + 'Many']({});
  res.json({ purged: true });
});

// a NON-database computed call must stay silent — no fabricated write
const helpers = { run: () => 1 };
const KEY = 'run';
app.get('/harmless', (req, res) => {
  helpers[KEY]();
  res.json({ ok: true });
});

app.listen(4802);
module.exports = app;

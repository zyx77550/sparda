// Object-scope provenance (ADR-058 B) — the substrate for BOLA. A query that targets a
// bare `id` is `idScoped`; if it ALSO filters by an ownership key (userId/…) or a session
// value it is `ownerScoped`. A route with an idScoped access and NO ownerScoped access
// anywhere on its path is a BOLA candidate. Also pins `findUniqueOrThrow` recognition —
// the ...OrThrow reads are exactly where the ownership-scoping fetch lives.
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
app.use(express.json());
const prisma = new PrismaClient();

function auth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  req.session = { user: { id: 'u1' } };
  next();
}

// scoped: the OrThrow fetch is filtered by the caller's id → ownerScoped (not a BOLA)
app.delete('/things/:id', auth, async (req, res) => {
  await prisma.thing.findUniqueOrThrow({
    where: { id: req.params.id, userId: req.session.user.id },
  });
  await prisma.thing.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// unscoped: fetched and deleted by bare id, no ownership predicate anywhere → BOLA shape
app.delete('/widgets/:id', auth, async (req, res) => {
  await prisma.widget.findUniqueOrThrow({ where: { id: req.params.id } });
  await prisma.widget.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

app.listen(4603);
module.exports = app;

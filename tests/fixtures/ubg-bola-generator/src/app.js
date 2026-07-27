import express from 'express';
import { assertRowOwner } from './guards.js';
const app = express();
app.use(express.json());
const prisma = { doc: { findUnique: async () => ({ ownerId: 'x' }) } };

// verified auth guard (proven 401 deny) so every route is "guarded"
const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  return next();
};

// FLAGGED BY THE STATIC PASS, YET SAFE — the ownership check (guards.js) is real, but it is
// reached through a variable indirection the resolver does not follow, so O7 stays. This is
// the generate-and-check target: a generator that READ the code points at the check's
// location; the deterministic verifier re-proves it there and discharges the advisory.
app.get('/docs/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  const check = assertRowOwner;
  check(row, req.user);
  res.json(row);
});

// CONTROL — a real BOLA: no ownership check anywhere on this path. No hint may clear it:
// a wrong location is rejected by the verifier, an unreachable-but-real check by the tether.
app.get('/leak/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  res.json(row);
});

app.listen(3000);

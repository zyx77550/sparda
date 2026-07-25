import express from 'express';
const app = express();
app.use(express.json());
const prisma = { doc: { findUnique: async () => ({ ownerId: 'x' }) } };

// verified auth guard (proven 401 deny) so every route is "guarded"
const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  return next();
};

// SAFE — ownership enforced by FETCH-THEN-COMPARE against the caller's principal, then DENY.
// The query's `where` is a bare `{ id }` (idScoped, not ownerScoped), so `whereOwnerScoped`
// abstains and O7 used to false-positive. The compare `row.ownerId !== req.user.id` gating a 403
// IS the ownership proof — the deterministic witness verifier recognizes it (ADR-074).
app.get('/docs/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  if (row.ownerId !== req.user.id) return res.sendStatus(403);
  res.json(row);
});

// UNSAFE — real BOLA: fetch by id, no ownership comparison. O7 must STAY.
app.get('/leak/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  res.json(row);
});

// ADVERSARIAL 1 — compares ownerId against ATTACKER-CONTROLLED input (req.body), not the
// principal. Spoofable → NOT ownership. The verifier must REJECT; O7 must STAY.
app.put('/spoof/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  if (row.ownerId !== req.body.ownerId) return res.sendStatus(403);
  res.json(row);
});

// ADVERSARIAL 2 — compares ownerId against the principal but does NOT deny (only logs). Not
// enforced → the verifier must REJECT; O7 must STAY.
app.patch('/nodeny/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  if (row.ownerId !== req.user.id) console.warn('mismatch');
  res.json(row);
});

app.listen(3000);

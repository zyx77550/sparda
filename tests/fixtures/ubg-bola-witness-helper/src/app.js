import express from 'express';
import { assertOwnerOf } from './guards.js';
const app = express();
app.use(express.json());
const prisma = { doc: { findUnique: async () => ({ ownerId: 'x' }) } };

// verified auth guard (proven 401 deny) so every route is "guarded"
const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  return next();
};

// The helper the safe routes delegate to: compare + deny, one call away. Its params carry
// no identity-shaped names on purpose — the binding must come from the CALL SITE.
function assertOwner(owned, callerId) {
  if (owned !== callerId) throw new ForbiddenError('not yours');
}
class ForbiddenError extends Error {}

// deny WITHOUT comparing the identity-bound param — proves nothing about ownership
// (name chosen OFF the admin/system vocabulary so O7's adminish filter stays out of the way)
function assertEditable(owned, callerId) {
  if (owned !== 'unlocked') throw new ForbiddenError('locked');
}

// compare WITHOUT deny — proves nothing
function warnMismatch(owned, callerId) {
  if (owned !== callerId) console.warn('mismatch');
}

// SAFE — ownership enforced by FETCH-THEN-COMPARE, but the compare+deny lives in the CALLED
// helper. The identity (`req.user.id`) is bound to the helper's param at the call site; the
// helper's body denies on the compare of exactly those two params (ADR-074 V2).
app.get('/docs/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  assertOwner(row.ownerId, req.user.id);
  res.json(row);
});

// SAFE — the whole-object form through an IMPORT: `assertOwnerOf(row, req.user)` compares
// `row.ownerId !== user.id` inside the imported helper. Member-off-param binding.
app.get('/docs2/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  assertOwnerOf(row, req.user);
  res.json(row);
});

// ADVERSARIAL 1 — the "identity" handed to the helper is ATTACKER-CONTROLLED (req.body).
// Spoofable → no identity binding at the call site → the advisory must STAY.
app.put('/spoof/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  assertOwner(row.ownerId, req.body.userId);
  res.json(row);
});

// ADVERSARIAL 2 — right bindings at the call site, but the helper only LOGS. Not enforced
// → the advisory must STAY.
app.patch('/nodeny/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  warnMismatch(row.ownerId, req.user.id);
  res.json(row);
});

// ADVERSARIAL 3 — the helper DENIES, but its compare ignores the identity-bound param
// (`owned !== 'unlocked'`). A deny that never consults the principal proves no ownership
// → the advisory must STAY.
app.get('/wrongcompare/:id', auth, async (req, res) => {
  const row = await prisma.doc.findUnique({ where: { id: req.params.id } });
  assertEditable(row.ownerId, req.user.id);
  res.json(row);
});

app.listen(3000);

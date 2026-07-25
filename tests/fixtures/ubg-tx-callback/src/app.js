// Interactive (callback) Prisma transaction — the dominant idiom. The writes go through the
// callback's `tx` client, whose name the /prisma|client|db/ heuristic can't see. Before the
// client-provenance bind, every write here VANISHED and the handler compiled to SURFACE.
import express from 'express';
const app = express();
app.use(express.json());
const prisma = {
  order: { create: async () => null },
  user: { update: async () => null },
  $transaction: async (cb) => cb(prisma),
};
function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'no' });
  next();
}
app.post('/orders', requireAuth, async (req, res) => {
  await prisma.$transaction(async (tx) => {
    await tx.order.create({ data: { userId: req.body.userId, amount: req.body.amount } });
    await tx.user.update({ where: { id: req.body.userId }, data: { balance: { decrement: req.body.amount } } });
  });
  res.status(201).json({ ok: true });
});
app.listen(3000);

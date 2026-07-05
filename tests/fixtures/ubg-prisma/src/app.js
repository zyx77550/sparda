// UBG Prisma fixture app — prisma client calls, zero raw SQL.
const express = require('express');
const app = express();
app.use(express.json());

// stand-in for @prisma/client — the compiler reads, never executes
const prisma = {
  user: { findUnique: async () => null, create: async () => null },
  order: { create: async () => null, update: async () => null },
};

function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/users/:id', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json({ id: req.params.id, email: user.email });
});

app.post('/orders', requireAuth, async (req, res) => {
  await prisma.order.create({
    data: { amount: req.body.amount, status: 'PENDING', userId: req.body.userId },
  });
  res.status(201).json({ ok: true });
});

app.patch('/orders/:id/pay', requireAuth, async (req, res) => {
  await prisma.order.update({
    where: { status: 'PENDING' },
    data: { status: 'PAID' },
  });
  res.json({ status: 'paid' });
});

app.listen(4602);
module.exports = app;

// Vendor-SDK effect fixture: the charge is an irreversible external call made through
// the Stripe SDK (no fetch/http-client skin), followed by a DB write. Without the innate
// PAMP receptor the charge resolved to nothing and O4 never fired (audit blind spot #1).
import express from 'express';
import Stripe from 'stripe';
const app = express();
app.use(express.json());
const stripe = new Stripe('sk_test');
const prisma = { payment: { create: async () => null } };

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'no' });
  next();
}

app.post('/pay', requireAuth, async (req, res) => {
  await stripe.charges.create({ amount: req.body.amount, currency: 'usd' });
  await prisma.payment.create({ data: { ref: req.body.ref, status: 'charged' } });
  res.json({ ok: true });
});

app.listen(3000);

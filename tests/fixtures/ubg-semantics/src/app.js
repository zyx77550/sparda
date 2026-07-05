// SBIR v1.1 fixture — transactions, compensation, validation, algebra.
const express = require('express');
const { z } = require('zod');
const db = require('./db');

const app = express();
app.use(express.json());

const bodySchema = z.object({ email: z.string().email() });

// deny without a token
function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// create a user — input validated before anything is written
app.post('/users', requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body' });
  }
  await db.query('INSERT INTO users (email) VALUES ($1)', [parsed.data.email]);
  res.status(201).json({ ok: true });
});

// place an order — all-or-nothing inside one transaction scope
app.post('/orders', requireAuth, async (req, res) => {
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO orders (user_id, amount, status) VALUES ($1, $2, 'pending')",
      [req.body.userId, req.body.amount],
    );
    await tx.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [
      req.body.amount,
      req.body.userId,
    ]);
  });
  res.status(201).json({ ok: true });
});

// charge the card — the refund compensates if bookkeeping fails
app.post('/pay', requireAuth, async (req, res) => {
  try {
    await fetch('https://api.stripe.example/charge', { method: 'POST' });
    await db.query('INSERT INTO orders (user_id, amount) VALUES ($1, $2)', [
      req.body.userId,
      req.body.amount,
    ]);
  } catch (err) {
    console.error('pay failed, refunding', err);
    await fetch('https://api.stripe.example/refund', { method: 'POST' });
  }
  res.status(201).json({ ok: true });
});

// mark an order paid — pending→paid is the only legal step from here
app.patch('/orders/:id/pay', requireAuth, async (req, res) => {
  await db.query(
    "UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'pending'",
    [req.params.id],
  );
  res.json({ status: 'paid' });
});

// refund a paid order — paid→refunded
app.patch('/orders/:id/refund', requireAuth, async (req, res) => {
  await db.query(
    "UPDATE orders SET status = 'refunded' WHERE id = $1 AND status = 'paid'",
    [req.params.id],
  );
  res.json({ status: 'refunded' });
});

// admin-only in theory — but nothing on the path enforces it (apocalypse bait)
app.delete('/orders/:id', async (req, res) => {
  await db.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// moves money across two tables of the same aggregate WITHOUT a transaction
app.post('/transfer', requireAuth, async (req, res) => {
  await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [
    req.body.amount,
    req.body.userId,
  ]);
  await db.query('INSERT INTO orders (user_id, amount) VALUES ($1, $2)', [
    req.body.userId,
    req.body.amount,
  ]);
  res.status(201).json({ ok: true });
});

// status probe — safe, idempotent, invisible to third parties (and entropy:
// wall-clock + dice, exactly what a flight recorder must virtualize)
app.get('/status', async (req, res) => {
  await fetch('https://status.example.com/ping', { method: 'GET' });
  const jitter = Math.random();
  res.json({ up: true, at: Date.now(), jitter });
});

app.listen(4601);
module.exports = app;

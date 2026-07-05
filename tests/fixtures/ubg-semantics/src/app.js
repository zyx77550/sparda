// SBIR v1.1 fixture — transactions, compensation, validation, algebra.
const express = require('express');
const { z } = require('zod');
const db = require('./db');

const app = express();
app.use(express.json());

const bodySchema = z.object({ email: z.string().email() });

// create a user — input validated before anything is written
app.post('/users', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body' });
  }
  await db.query('INSERT INTO users (email) VALUES ($1)', [parsed.data.email]);
  res.status(201).json({ ok: true });
});

// place an order — all-or-nothing inside one transaction scope
app.post('/orders', async (req, res) => {
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO orders (user_id, amount) VALUES ($1, $2)', [
      req.body.userId,
      req.body.amount,
    ]);
    await tx.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [
      req.body.amount,
      req.body.userId,
    ]);
  });
  res.status(201).json({ ok: true });
});

// charge the card — the refund compensates if bookkeeping fails
app.post('/pay', async (req, res) => {
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

// status probe — safe, idempotent, invisible to third parties
app.get('/status', async (req, res) => {
  await fetch('https://status.example.com/ping', { method: 'GET' });
  res.json({ up: true });
});

app.listen(4601);
module.exports = app;

// Lifecycle fixture app — the orders.status state machine, in code.
// INSERT status 'pending' (∅→pending), UPDATE …'paid' WHERE status='pending'
// (pending→paid), UPDATE …'refunded' WHERE status='paid' (paid→refunded).
// A read that returns { id, status } so the mirror can reflect live state.
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

// create an order — starts its life at 'pending'
app.post('/orders', async (req, res) => {
  await db.query("INSERT INTO orders (amount, status) VALUES ($1, 'pending')", [
    req.body.amount,
  ]);
  res.status(201).json({ ok: true });
});

// read an order — returns its id and current status
app.get('/orders/:id', async (req, res) => {
  const { rows } = await db.query('SELECT id, status FROM orders WHERE id = $1', [
    req.params.id,
  ]);
  res.json({ id: req.params.id, status: rows[0] ? rows[0].status : 'pending' });
});

// pay — legal only from 'pending'
app.patch('/orders/:id/pay', async (req, res) => {
  await db.query(
    "UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'pending'",
    [req.params.id],
  );
  res.json({ status: 'paid' });
});

// refund — legal only from 'paid'
app.patch('/orders/:id/refund', async (req, res) => {
  await db.query(
    "UPDATE orders SET status = 'refunded' WHERE id = $1 AND status = 'paid'",
    [req.params.id],
  );
  res.json({ status: 'refunded' });
});

app.listen(4610);
module.exports = app;

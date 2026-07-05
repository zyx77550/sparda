// UBG fixture app — every node kind reachable, plus one dead helper.
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

// denies without a token — must classify as guard
function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// two plain middlewares in a row — StateMinimization fodder
function logRequest(req, res, next) {
  console.log('req', req.url);
  next();
}

function tagRequest(req, res, next) {
  req.tag = 'ubg';
  next();
}

// never called from any route — DeadPathElimination fodder
function unusedHelper() {
  return 42;
}

// read one user
app.get('/users/:id', logRequest, tagRequest, async (req, res) => {
  const { id } = req.params;
  const result = await db.query('SELECT id, email, active FROM users WHERE id = $1', [
    id,
  ]);
  const row = result.rows[0];
  res.json({ id: id, email: row.email, active: row.active });
});

// create a user — requires auth, mutates state, notifies a webhook
app.post('/users', requireAuth, async (req, res) => {
  await db.query('INSERT INTO users (email) VALUES ($1)', [req.body.email]);
  await fetch('https://hooks.example.com/user-created', { method: 'POST' });
  res.status(201).json({ ok: true });
});

app.listen(4599);
module.exports = app;

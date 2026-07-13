import express from 'express';
import knex from 'knex';
import axios from 'axios';
import { legacyHandler } from './legacy.js';

const app = express();
app.use(express.json());
const db = knex({ client: 'pg' });

// SYMBOLIC: table comes from the URL param — resolved as :collection, NOT a blind spot
app.get('/items/:collection', async (req, res) => {
  const rows = await db(req.params.collection).select('*');
  res.json({ data: rows });
});

// SYMBOLIC write on a mutating route — resolved, guarded by requireAuth
app.post('/items/:collection', requireAuth, async (req, res) => {
  await db(req.params.collection).insert(req.body);
  res.status(201).json({ ok: true });
});

// OPAQUE TARGET: external call to a computed URL — SPARDA sees the http_call, not the host
app.post('/webhook/relay', async (req, res) => {
  await axios.post(req.body.targetUrl, req.body.payload);
  res.json({ relayed: true });
});

// UNVERIFIED GUARD: named like auth, opaque body (imported) — trusted, not verified
function requireAuth(req, res, next) {
  return checkToken(req, res, next);
}

// BLIND MUTATION: handler is an opaque imported value — a POST whose behavior is unseen
app.put('/legacy/:id', legacyHandler);

// GENUINE NO-OP: a mutating route SPARDA fully read — empty body, must NOT be flagged blind
app.delete('/ping', (req, res) => {
  res.sendStatus(204);
});

app.listen(3000);

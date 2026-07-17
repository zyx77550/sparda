import express from 'express';
import { knex } from './db.js';

const app = express();

// A read-only surface: routes exist and resolve to db READS, but nothing mutates.
// SPARDA can discharge no safety obligation here (guard/atomicity are about writes),
// so this must read SURFACE, never a vacuous PROVEN.
app.get('/items', async (req, res) => {
  const rows = await knex.select('*').from('items');
  res.json(rows);
});

app.get('/items/:id', async (req, res) => {
  const row = await knex.select('*').from('items').where({ id: req.params.id });
  res.json(row);
});

app.listen(3000);

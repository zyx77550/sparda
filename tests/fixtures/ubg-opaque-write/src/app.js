// Opaque write on a PROVEN persistence handle (ADR-068). `db` is a knex handle by provenance
// (imported from 'knex', built via knex(...)). `db.purgeEverything(...)` is a custom method SPARDA
// can't read — but on a proven DB handle, the safe direction is inverted: treat it as a write, or
// an unguarded custom write passes invisible (a hidden hole). A READ (db.select) must NOT be
// treated as a write, and a GUARDED opaque write must be covered by its guard.
import express from 'express';
import knex from 'knex';
const db = knex({ client: 'pg' });
const app = express();
app.use(express.json());

function requireAdmin(req, res, next) {
  if (req.headers['x-role'] !== 'admin') return res.status(403).json({ error: 'no' });
  next();
}

// UNGUARDED opaque write → MUST flag (was invisible before).
app.post('/purge', async (req, res) => {
  await db.purgeEverything(req.body.scope);
  res.json({ ok: true });
});

// GUARDED opaque write → must NOT flag (the guard covers it).
app.post('/admin/purge', requireAdmin, async (req, res) => {
  await db.purgeEverything('all');
  res.json({ ok: true });
});

// a READ on the handle → must NOT be treated as a write (no flood).
app.get('/list', async (req, res) => {
  const rows = await db.select('*').from('items');
  res.json(rows);
});

app.listen(3000);

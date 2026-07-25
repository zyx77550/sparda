// A guarded DELETE and a guarded UPDATE on a table with UNIQUE/NOT NULL columns. The DELETE
// removes a row — it cannot violate a value constraint, so O2 must NOT flag it. The UPDATE
// writes values from unvalidated input — O2 MUST flag it.
import express from 'express';
const app = express();
app.use(express.json());
const db = { members: { delete: async () => null, update: async () => null } };
function requireAdmin(req, res, next) {
  if (req.headers['x-role'] !== 'admin') return res.status(403).json({ error: 'no' });
  next();
}
app.post('/members/:id/delete', requireAdmin, async (req, res) => {
  await db.members.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
app.post('/members/:id/rename', requireAdmin, async (req, res) => {
  await db.members.update({ where: { id: req.params.id }, data: { name: req.body.name } });
  res.json({ ok: true });
});
app.listen(3000);

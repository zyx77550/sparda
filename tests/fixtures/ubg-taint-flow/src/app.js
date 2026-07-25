// Value-flow / taint into a constrained write (ADR-064). `posts.title` is NOT NULL UNIQUE, so an
// UPDATE that writes an unvalidated value into it is O2 (UNVALIDATED_CONSTRAINED_WRITE). The point
// here is HOW the request data reaches the column — the taint pass must follow it through the
// common value-flow shapes, and O2 must become proof-grade only when the flow is actually proven.
import express from 'express';
const app = express();
app.use(express.json());
const db = { posts: { update: async () => null } };
function requireAdmin(req, res, next) {
  if (req.headers['x-role'] !== 'admin') return res.status(403).json({ error: 'no' });
  next();
}

// DESTRUCTURING — the dominant handler idiom. Request data reaches title via a destructured
// binding, invisible to the old direct-member taint. O2 must fire PROOF-GRADE (tainted).
app.post('/posts/:id/retitle', requireAdmin, async (req, res) => {
  const { title } = req.body;
  await db.posts.update({ where: { id: req.params.id }, data: { title } });
  res.json({ ok: true });
});

// IDENTIFIER ALIAS — `payload` aliases the whole request body, then flows into the write.
app.post('/posts/:id/replace', requireAdmin, async (req, res) => {
  const raw = req.body;
  const payload = raw;
  await db.posts.update({ where: { id: req.params.id }, data: payload });
  res.json({ ok: true });
});

// INTERPROCEDURAL — the write lives inside a helper; the destructured request title crosses the
// call boundary as an argument. Taint must follow it through the call so O2 stays proof-grade.
function applyTitle(id, title) {
  return db.posts.update({ where: { id }, data: { title } });
}
app.post('/posts/:id/via-helper', requireAdmin, async (req, res) => {
  const { title } = req.body;
  applyTitle(req.params.id, title);
  res.json({ ok: true });
});

// SERVER-CONTROLLED — the written value is a server literal, no request data reaches the column.
// Taint is (correctly) not proven, so O2 stays the CONSERVATIVE flag (it still fires — we never
// drop a finding just because taint didn't see a flow — but it is NOT marked proof-grade).
app.post('/posts/:id/publish', requireAdmin, async (req, res) => {
  await db.posts.update({ where: { id: req.params.id }, data: { title: 'published' } });
  res.json({ ok: true });
});

app.listen(3000);

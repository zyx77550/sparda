// The type-lock (ADR-070) — VERIFIED case. The guard's deny is visible IN-REPO (res.status(403)),
// so SPARDA proves it → verified. The mutation's protection is PROVEN, so the app reads PROVEN.
// This is the control: the lock must NOT downgrade a genuinely-proven app.
import express from 'express';
const app = express();
app.use(express.json());
const prisma = { post: { update: async () => null } };
function requireAdmin(req, res, next) {
  if (req.headers['x-role'] !== 'admin') return res.status(403).json({ error: 'no' });
  next();
}
app.post('/posts/:id', requireAdmin, async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: req.body.title } });
  res.json({ ok: true });
});
app.listen(3000);

// The type-lock (ADR-070) — ASSERTED case. The mutation is guarded ONLY by an opaque imported
// middleware SPARDA can't read (an unknown auth lib), so the guard is asserted, not verified. The
// app is clean (no UNGUARDED finding) only because an UNPROVEN signal suppressed it → PARTIAL,
// never PROVEN. (A known lib like passport would be verified via the ADR-069 catalog and stay PROVEN.)
import express from 'express';
import { requireAuth } from 'some-unknown-auth-lib';
const app = express();
app.use(express.json());
const prisma = { post: { update: async () => null } };
app.post('/posts/:id', requireAuth, async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: req.body.title } });
  res.json({ ok: true });
});
app.listen(3000);

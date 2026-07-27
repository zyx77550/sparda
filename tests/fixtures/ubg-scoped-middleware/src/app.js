// Z6 corpus — the Express twin of E-NEXT-MW. A middleware mounted at a PATH runs
// only under that prefix, but was credited to every route: an unguarded
// `POST /admin/wipe` read PROVEN with one VERIFIED guard it never runs behind.
import express from 'express';
import { expressjwt } from 'express-jwt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

// auth scoped to /api ONLY
app.use('/api', expressjwt({ secret: 'k', algorithms: ['HS256'] }));

// under the prefix → legitimately guarded
app.post('/api/notes', async (req, res) => {
  await prisma.note.create({ data: { text: req.body.text } });
  res.json({ ok: true });
});

// NOT under the prefix → genuinely unguarded, must flag
app.post('/admin/wipe', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ wiped: true });
});

// prefix-of-a-longer-segment: /api does NOT cover /apikeys
app.post('/apikeys/rotate', async (req, res) => {
  await prisma.user.deleteMany({});
  res.json({ rotated: true });
});

app.listen(4803);
export default app;

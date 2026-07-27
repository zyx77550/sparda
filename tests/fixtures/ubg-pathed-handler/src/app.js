// C3 corpus — a callable mounted at a PATH. Express decides its role at runtime, so
// SPARDA decides it by BEHAVIOUR: a function that hands control on is a middleware,
// one that never can is a terminal endpoint answering every verb at that path.
import express from 'express';
import { PrismaClient } from '@prisma/client';
import admin from './admin.js';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// a real MIDDLEWARE at a path: it calls next(), so it scopes — it is not an endpoint
app.use('/api', requireAuth);

app.post('/api/notes', async (req, res) => {
  await prisma.note.create({ data: { text: req.body.text } });
  res.status(201).json({ ok: true });
});

// C3: a TERMINAL handler at a path — never calls next, so /admin/wipe is a real
// endpoint on every verb, and it is completely unguarded
app.use('/admin/wipe', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ wiped: true });
});

// the same shape one level down, inside a mounted router
app.use('/sub', admin);

app.listen(4806);
export default app;

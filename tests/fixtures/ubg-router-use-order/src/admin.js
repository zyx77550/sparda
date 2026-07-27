// A router-level guard protects only what follows it. Every route in a mounted file
// shares the MOUNT's position, so without an intra-file rank the guard below would be
// credited to the route above it — a false PROVEN manufactured by the fix that made
// router-level guards visible at all.
import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = express.Router();

// declared BEFORE the guard — Express never runs requireAuth for it
router.post('/early', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  next();
}
router.use(requireAuth);

// declared AFTER — genuinely guarded
router.post('/late', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ ok: true });
});

export default router;

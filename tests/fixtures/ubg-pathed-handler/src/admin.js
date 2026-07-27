import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = express.Router();

// nested terminal handler at a path — depth 1, previously dropped entirely
router.use('/purge', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({ purged: true });
});

export default router;

// A guarded route that reads a Link by a bare request id — the BOLA shape. Link has a userId
// column, so the ownership-model inference should say "direct-owner (userid)".
import express from 'express';
import { PrismaClient } from '@prisma/client';
const app = express();
const prisma = new PrismaClient();

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'no auth' });
  next();
}

app.get('/links/:id', requireAuth, async (req, res) => {
  const link = await prisma.link.findUnique({ where: { id: req.params.id } });
  res.json(link);
});

app.listen(3000);

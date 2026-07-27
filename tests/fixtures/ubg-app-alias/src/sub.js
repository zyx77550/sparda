const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// the router is aliased before any route is registered on it
const router = express.Router();
const r2 = router;

r2.post('/create', async (req, res) => {
  await prisma.note.create({ data: { text: req.body.text } });
  res.json({ ok: true });
});

module.exports = router;

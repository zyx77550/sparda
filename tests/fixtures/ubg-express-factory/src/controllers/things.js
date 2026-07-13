const express = require('express');
const router = express.Router();
const prisma = { thing: { create: async () => null, findMany: async () => [] } };

router.get('/', async (req, res) => {
  res.json(await prisma.thing.findMany());
});

// unguarded mutation → a real finding, proving the whole chain resolved from a factory
router.post('/', async (req, res) => {
  await prisma.thing.create({ data: req.body });
  res.status(201).json({ ok: true });
});

module.exports = router;

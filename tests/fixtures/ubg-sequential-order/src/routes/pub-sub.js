const express = require('express');
const router = express.Router();

const prisma = {
  tag: { create: async () => null },
};

router.post('/create', async (req, res) => {
  await prisma.tag.create({ data: { name: req.body.name } });
  res.status(201).json({ ok: true });
});

module.exports = router;

const express = require('express');
const router = express.Router();

const prisma = {
  vault: { create: async () => null },
};

router.post('/create', async (req, res) => {
  await prisma.vault.create({ data: { name: req.body.name } });
  res.status(201).json({ ok: true });
});

module.exports = router;

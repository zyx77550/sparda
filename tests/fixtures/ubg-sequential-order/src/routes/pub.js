const express = require('express');
const router = express.Router();

const prisma = {
  item: { create: async () => null },
};

router.post('/create', async (req, res) => {
  await prisma.item.create({ data: { name: req.body.name } });
  res.status(201).json({ ok: true });
});

// nested mount: sub-routes must inherit the TOP mount's position (before auth)
router.use('/sub', require('./pub-sub'));

module.exports = router;

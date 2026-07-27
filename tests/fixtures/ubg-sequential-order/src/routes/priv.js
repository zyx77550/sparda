const express = require('express');
const router = express.Router();

const prisma = {
  secret: { create: async () => null },
};

router.post('/create', async (req, res) => {
  await prisma.secret.create({ data: { name: req.body.name } });
  res.status(201).json({ ok: true });
});

// nested mount: sub-routes must inherit the TOP mount's position (after auth)
router.use('/sub', require('./priv-sub'));

module.exports = router;

const express = require('express');
const router = express.Router();

// mounted only inside an if-block — the walk must still find it
router.get('/stats', (req, res) => res.json({ ok: true }));

module.exports = router;

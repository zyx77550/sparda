const express = require('express');
const router = express.Router();

router.get('/', (req, res) => res.json({ items: [] }));
router.post('/', (req, res) => res.status(201).json({ created: true }));

module.exports = router;

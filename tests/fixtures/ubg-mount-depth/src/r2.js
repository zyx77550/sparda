const express = require('express');
const router = express.Router();
router.get('/two', (req, res) => res.json({}));
router.use('/c', require('./r3'));
module.exports = router;

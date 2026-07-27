const express = require('express');
const router = express.Router();
router.get('/one', (req, res) => res.json({}));
router.use('/b', require('./r2'));
module.exports = router;

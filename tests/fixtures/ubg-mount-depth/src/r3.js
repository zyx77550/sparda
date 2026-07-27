const express = require('express');
const router = express.Router();
// below the depth bound — this route must be reported as unexplored surface
router.post('/three', (req, res) => res.json({}));
module.exports = router;

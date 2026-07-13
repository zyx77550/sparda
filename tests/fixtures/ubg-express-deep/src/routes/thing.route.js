const express = require('express');
const auth = require('../middlewares/auth');
const thingController = require('../controllers/thing.controller');

const router = express.Router();

// guarded by auth() middleware — must NOT be flagged
router.post('/', auth(), thingController.create);

// no guard — a genuine unguarded mutation
router.post('/public', thingController.create);

module.exports = router;

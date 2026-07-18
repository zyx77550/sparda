const express = require('express');
const auth = require('../middlewares/auth');
const orderController = require('../controllers/order.controller');

const router = express.Router();
router.post('/', auth(), orderController.create); // guarded — must NOT be flagged
router.post('/public', orderController.create); // unguarded cross-package mutation
module.exports = router;

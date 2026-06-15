const express = require('express');
const usersRouter = express.Router();

/** Get user CJS */
usersRouter.get('/:id', (req, res) => res.json({ id: req.params.id }));

module.exports = usersRouter;

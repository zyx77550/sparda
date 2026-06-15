import express = require('express');
const usersRouter = express.Router();

/** Get user details */
usersRouter.get('/:id', (req: any, res: any) => res.json({ id: req.params.id }));

export = usersRouter;

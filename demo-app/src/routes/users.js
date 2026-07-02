import { Router } from 'express';
export const usersRouter = Router();

/** Get a single user by id */
usersRouter.get('/:id', (req, res) => res.json({ id: req.params.id, name: 'Zak', role: 'founder' }));

/** Create a new user account */
usersRouter.post('/', (req, res) => res.status(201).json({ created: true, ...req.body }));

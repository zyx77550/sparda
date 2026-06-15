import { Router, Request, Response } from 'express';

export const usersRouter = Router();

/** Retrieve a user by their unique identifier. */
usersRouter.get('/:id', (req: Request, res: Response) => {
  res.json({ id: req.params.id });
});

import express from 'express';
import asyncHandler from './async-handler.js';
import { ItemsService } from './items.service.js';
import { requireAuth } from './auth.js';

const app = express();
app.use(express.json());

// UNBOUNDED: the caller names the table AND there is no guard → the escalation.
app.post(
  '/open/:collection',
  asyncHandler(async (req, res) => {
    const service = new ItemsService(req.params.collection);
    await service.createOne(req.body);
    res.status(201).json({ ok: true });
  }),
);

// GUARDED symbolic write: still request-named, but a guard gates the path — the
// directus posture. Must NOT be flagged UNBOUNDED_WRITE_TARGET (only UNGUARDED is).
app.post(
  '/guarded/:collection',
  requireAuth,
  asyncHandler(async (req, res) => {
    const service = new ItemsService(req.params.collection);
    await service.createOne(req.body);
    res.status(201).json({ ok: true });
  }),
);

app.listen(3000);

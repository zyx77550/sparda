import express from 'express';
import asyncHandler from './async-handler.js';
import { ThingsService } from './things.service.js';

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = new ThingsService({ schema: req.schema });
    const rows = await service.readAll(req.query);
    res.json({ data: rows });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const service = new ThingsService({ schema: req.schema });
    const key = await service.createOne(req.body);
    res.status(201).json({ key });
  }),
);

export default router;

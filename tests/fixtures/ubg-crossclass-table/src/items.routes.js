import express from 'express';
import asyncHandler from './async-handler.js';
import { ItemsService } from './base.service.js';
import { ActivityService } from './activity.service.js';

const router = express.Router();

// GENERIC CRUD: the table is named by the URL param → must resolve to :collection
router.get(
  '/:collection',
  asyncHandler(async (req, res) => {
    const service = new ItemsService(req.params.collection, { schema: req.schema });
    const rows = await service.readByQuery();
    res.json({ data: rows });
  }),
);

router.post(
  '/:collection',
  asyncHandler(async (req, res) => {
    const service = new ItemsService(req.params.collection, { schema: req.schema });
    const key = await service.createOne(req.body);
    res.status(201).json({ key });
  }),
);

// FIXED table via super('directus_activity') → concrete table, not symbolic
router.get(
  '/activity/all',
  asyncHandler(async (req, res) => {
    const service = new ActivityService({ schema: req.schema });
    const rows = await service.readByQuery();
    res.json({ data: rows });
  }),
);

export default router;

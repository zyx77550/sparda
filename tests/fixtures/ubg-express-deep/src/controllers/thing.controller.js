const catchAsync = require('../utils/catchAsync');
const { thingService } = require('../services');

// catchAsync-wrapped handler → service call (member) → the real effect two hops down
const create = catchAsync(async (req, res) => {
  const thing = await thingService.createThing(req.body);
  res.status(201).send({ thing });
});

module.exports = { create };

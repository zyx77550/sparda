const catchAsync = require('../utils/catchAsync');
const { orderService } = require('@acme/data'); // cross-package: the write is one workspace away

const create = catchAsync(async (req, res) => {
  const order = await orderService.createOrder(req.body);
  res.status(201).send({ order });
});

module.exports = { create };

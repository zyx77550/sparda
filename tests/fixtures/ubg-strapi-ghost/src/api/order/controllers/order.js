'use strict';

module.exports = {
  async find(ctx) {
    return ctx.send({ orders: [] });
  },
};

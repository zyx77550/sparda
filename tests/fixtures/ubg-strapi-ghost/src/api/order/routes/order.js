'use strict';

// The route table DECLARES this endpoint, so Strapi serves it — but `order.refund` is
// not among the controller's exports (it lives in a plugin, or it was renamed). The
// route must stay AND the unread controller must be declared: a hand-written mutation
// SPARDA never opened cannot be allowed to read as a resolved, understood route.
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/orders/:id/refund',
      handler: 'order.refund',
      config: { auth: false },
    },
  ],
};

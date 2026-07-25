'use strict';

// A Strapi controller. Custom actions carry the real effects; the core CRUD actions
// (find/findOne/create/update/delete) are framework defaults, absent here — SPARDA
// synthesizes their write from the route's verb + uid.
module.exports = {
  async publish(ctx) {
    // a write on a PUBLIC route (config.auth:false in the route table)
    await strapi.entityService.update('api::article.article', ctx.params.id, {
      data: { publishedAt: new Date() },
    });
    return { ok: true };
  },

  async remove(ctx) {
    await strapi.db.query('api::article.article').delete({ where: { id: ctx.params.id } });
    return { ok: true };
  },
};

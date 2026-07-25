'use strict';

// A Strapi CUSTOM route table — declarative, invisible to any app.get()/decorator scan.
module.exports = {
  routes: [
    {
      // auth: false → genuinely public. A mutation here MUST flag unguarded.
      method: 'POST',
      path: '/articles/publish',
      handler: 'article.publish',
      config: { auth: false },
    },
    {
      // no config → the app is guarded-by-default (an opt-out exists elsewhere), so this
      // gets an asserted framework-default-auth guard (ADR-055 posture).
      method: 'DELETE',
      path: '/articles/:id',
      handler: 'article.remove',
    },
  ],
};

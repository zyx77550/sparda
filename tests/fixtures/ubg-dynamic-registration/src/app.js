// Dynamic-registration fixture: routes registered through computed properties,
// Reflect.apply and .call escape classical static analysis — each one must
// degrade certainty as an UnknownHandler, never vanish silently.
const express = require('express');
const app = express();
app.use(express.json());

// computed verb over a dynamic iteration — statically unbindable
const verbs = ['get', 'post'];
for (const v of verbs) {
  app[v]('/dyn', (req, res) => res.json({ via: v }));
}

// Reflect.apply indirection
Reflect.apply(app.get, app, ['/reflected', (req, res) => res.json({})]);

// .call indirection over a known registration verb
app.get.call(app, '/called', (req, res) => res.json({}));

// one plain route so the app still has a visible surface
app.get('/plain', (req, res) => res.json({ ok: true }));

app.listen(4702);
module.exports = app;

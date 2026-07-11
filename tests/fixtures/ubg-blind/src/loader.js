// The route surface the static eye cannot follow: `app` is a bare parameter,
// not an express() binding, so app.get(...) here is invisible to the parser.
module.exports = (app) => {
  app.get('/hidden', (req, res) => res.json({ ok: true }));
  app.post('/hidden', (req, res) => res.json({ created: true }));
};

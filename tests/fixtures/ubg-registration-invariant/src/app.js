// The structural invariant's witness: every shape below is a call on the app that
// SPARDA does NOT model as a route. Each one MUST surface as an UnknownHandler —
// none may leave the extractor silently. The known-plumbing block at the bottom
// must produce exactly zero.
const express = require('express');
const app = express();

// 1 — an HTTP verb Express supports but SPARDA does not model
app.options('/opt', (req, res) => res.json({}));

// 2 — a WebDAV-ish verb (Express forwards every method in `methods`)
app.propfind('/dav', (req, res) => res.json({}));

// 3 — computed verb
const v = 'post';
app[v]('/computed', (req, res) => res.json({}));

// 4 — Reflect.apply indirection
Reflect.apply(app.get, app, ['/reflected', (req, res) => res.json({})]);

// 5 — .call indirection over a registration verb
app.get.call(app, '/called', (req, res) => res.json({}));

// 6 — a route chain whose base path is not a literal
const p = '/dyn';
app.route(p).post((req, res) => res.json({}));

// 7 — app.all with a non-literal path
app.all(p, (req, res) => res.json({}));

// ---- known plumbing: MUST stay silent (zero UnknownHandlers) ----------------
app.set('trust proxy', 1);
app.enable('etag');
app.disable('x-powered-by');
app.engine('html', () => {});
app.param('id', (req, res, next) => next());
app.on('mount', () => {});
app.once('close', () => {});
app.listen(4804);

module.exports = app;

// Inline-require mount idiom (rootpath-style apps): the router is mounted with
// `app.use('/prefix', require('./x.controller'))` rather than a pre-imported
// Identifier. The parser must resolve the inline require to the controller file
// so its routes reach the graph (regression guard for C-001a).
const express = require('express');
const app = express();

app.use('/things', require('./things.controller'));

module.exports = app;

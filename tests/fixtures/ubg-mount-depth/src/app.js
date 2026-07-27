// Mount-depth fixture: a router chain deeper than the walk's bound. The
// unexplored tail must surface as a declared skipped-surface, never vanish.
const express = require('express');
const app = express();

app.use('/a', require('./r1'));

app.listen(4703);
module.exports = app;

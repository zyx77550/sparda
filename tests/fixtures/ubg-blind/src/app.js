// Blind fixture: routes are registered indirectly through a loader that
// receives `app` as a parameter — the static walk never sees an `express()`
// binding for it, so ZERO entrypoints reach the graph. This is the shape that
// used to compile to a vacuous "PROVEN over 0 nodes"; the provability guard now
// makes it an honest NO PROOF instead.
const express = require('express');
const app = express();

require('./loader')(app);

module.exports = app;

// Deliberately unparseable: syntax outside the modeled grammar. SPARDA must
// refuse to certify (NO_PROOF), never guess or crash.
const express = require('express');
const app = express(;
app.get('/broken' (req res) => { res.json({) };
app.listen(4704

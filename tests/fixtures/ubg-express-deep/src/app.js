const express = require('express');
const thingRoute = require('./routes/thing.route');
const app = express();
app.use(express.json());
app.use('/things', thingRoute);
app.listen(4604);
module.exports = app;

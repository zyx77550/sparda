const express = require('express');
const orderRoute = require('./routes/order.route');
const app = express();
app.use(express.json());
app.use('/orders', orderRoute);
app.listen(4605);
module.exports = app;

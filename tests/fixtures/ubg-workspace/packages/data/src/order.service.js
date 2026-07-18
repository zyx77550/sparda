const { Order } = require('./models');
// the leaf effect — in a SIBLING workspace package, reached only via @acme/data
module.exports.createOrder = async (body) => Order.create(body);

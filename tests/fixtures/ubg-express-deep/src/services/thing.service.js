const { Thing } = require('../models');

// the leaf effect — a Mongoose model write, reached via the barrel
const createThing = async (body) => Thing.create(body);

module.exports = { createThing };

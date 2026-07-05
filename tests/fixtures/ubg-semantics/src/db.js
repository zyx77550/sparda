// stub pg-style client with a transaction wrapper — read, never executed
module.exports = {
  query: async () => ({ rows: [] }),
  transaction: async (cb) => cb(module.exports),
};

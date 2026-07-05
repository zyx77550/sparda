// stub pg-style client — the UBG compiler never executes this, it only reads it
module.exports = {
  query: async () => ({ rows: [] }),
};

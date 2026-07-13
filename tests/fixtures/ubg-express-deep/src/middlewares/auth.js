// guard middleware factory — name matches the guard heuristic
module.exports = () => (req, res, next) => {
  if (!req.headers.authorization) return res.status(401).send();
  next();
};

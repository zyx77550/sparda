// A real guard: it can deny with 403.
export function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

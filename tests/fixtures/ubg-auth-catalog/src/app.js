// Auth-library deny catalog (ADR-069). An opaque npm auth guard — passport.authenticate,
// express-jwt — has its body in node_modules, so SPARDA can't read the deny in-repo. The catalog
// is a VERIFIED published fact that these DENY, so the guard reads `verified` (→ the app can reach
// PROVEN), not merely `asserted`. Deny-FORM precision keeps it honest: a custom passport callback
// does NOT auto-deny, so it stays asserted.
import express from 'express';
import passport from 'passport';
import { expressjwt } from 'express-jwt';
const app = express();
app.use(express.json());
const prisma = { post: { update: async () => null, delete: async () => null } };

// deny-form passport.authenticate (no callback) → VERIFIED
app.post('/inline/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: req.body.title } });
  res.json({ ok: true });
});

// aliased express-jwt → VERIFIED
const requireJwt = expressjwt({ secret: 's', algorithms: ['HS256'] });
app.post('/aliased/:id', requireJwt, async (req, res) => {
  await prisma.post.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// passport.authenticate WITH a custom callback → does NOT auto-deny → stays ASSERTED (honest)
app.post('/callback/:id', passport.authenticate('jwt', (e, u) => u), async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: 'x' } });
  res.json({ ok: true });
});

// ALIASED passport.authenticate WITH a callback → must ALSO stay ASSERTED (the callback body,
// scanned in-repo, does not deny — so it reads asserted regardless of the catalog).
const customAuth = passport.authenticate('jwt', (e, u) => u);
app.post('/aliased-cb/:id', customAuth, async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: 'y' } });
  res.json({ ok: true });
});

// express-jwt WITH credentialsRequired:false → does NOT deny (it lets anonymous through) → the
// catalog MUST abstain (stay ASSERTED), or it would falsely VERIFY a guard that passes anyone.
const optionalJwt = expressjwt({ secret: 's', algorithms: ['HS256'], credentialsRequired: false });
app.post('/optional/:id', optionalJwt, async (req, res) => {
  await prisma.post.update({ where: { id: req.params.id }, data: { title: 'z' } });
  res.json({ ok: true });
});

app.listen(3000);

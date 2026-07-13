import express from 'express';

const application = express();
application.use(express.json());

const db = { user: { create: async () => null } };

function requireAuth(req: any, res: any, next: any) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'unauthorized' });
  next();
}

application.get('/health', (req: any, res: any) => res.json({ ok: true }));

// a guarded mutation — SPARDA should see it once the weird entry is found
application.post('/users', requireAuth, async (req: any, res: any) => {
  await db.user.create({ data: { email: req.body.email } });
  res.status(201).json({ created: true });
});

application.listen(4605);
export default application;

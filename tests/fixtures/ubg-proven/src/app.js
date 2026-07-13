// A genuinely PROVEN app: SPARDA sees a real mutation AND every obligation holds.
// The write is guarded (auth), input-validated (zod schema), single-row (atomic),
// and reversible (a plain db row, no external irreversible effect).
const express = require('express');
const { z } = require('zod');
const app = express();
app.use(express.json());

const prisma = {
  note: { create: async () => null },
};

const noteSchema = z.object({ text: z.string().min(1) });

function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/notes', requireAuth, async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid' });
  }
  await prisma.note.create({ data: { text: parsed.data.text, done: false } });
  res.status(201).json({ ok: true });
});

app.listen(4603);
module.exports = app;

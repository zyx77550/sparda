// The dynamic spellings of a database write. Each one used to produce NO effect at
// all, so the route around it read as a harmless no-op and the app could reach PROVEN.
import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// optional chaining on the handle
app.post('/a', async (req, res) => {
  await prisma?.note?.deleteMany({});
  res.json({});
});

// optional CALL on the method
app.post('/b', async (req, res) => {
  await prisma.note.deleteMany?.({});
  res.json({});
});

// a tagged template running raw SQL
app.post('/c', async (req, res) => {
  await prisma.$executeRaw`DELETE FROM "Note"`;
  res.json({});
});

// a receiver with no nameable root
app.post('/d', async (req, res) => {
  await (req.query.x ? prisma.note : prisma.note).deleteMany({});
  res.json({});
});

// optional chaining on the APP object — the registration itself
app?.post('/e', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({});
});
app.post?.('/f', async (req, res) => {
  await prisma.note.deleteMany({});
  res.json({});
});

// the CALLEE itself is unnameable — not a member at all, just an expression that
// evaluates to a database method
app.post('/g', async (req, res) => {
  await (req.query.x ? prisma.note.deleteMany : prisma.note.deleteMany)({});
  res.json({});
});

// control: a computed call on a NON-database object must fabricate nothing
const helpers = { run: () => 1 };
const KEY = 'run';
app.get('/harmless', (req, res) => {
  helpers?.[KEY]?.();
  res.json({});
});

app.listen(4807);
export default app;

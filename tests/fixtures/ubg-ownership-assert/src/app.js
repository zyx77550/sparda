const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();

function requireAuth(req, res, next) {
  if (!req.session) return res.status(401).end();
  next();
}

// ASSERTED: a call-site ownership assertion scopes the object to the caller → NO BOLA
app.delete('/things/:id', requireAuth, async (req, res) => {
  const thing = await getThingOrThrow({ workspaceId: req.session.workspace.id, id: req.params.id });
  await prisma.thing.delete({ where: { id: thing.id } });
  res.end();
});

// RAW: id from the request, no ownership proven anywhere → BOLA advisory fires
app.delete('/raw/:id', requireAuth, async (req, res) => {
  await prisma.thing.delete({ where: { id: req.params.id } });
  res.end();
});

// SPOOF: the "scope" comes from the request BODY (attacker-controlled), not the verified
// identity — this must NOT count as an assertion, so BOLA still fires (soundness guard)
app.delete('/spoof/:id', requireAuth, async (req, res) => {
  const thing = await getThingOrThrow({ workspaceId: req.body.workspaceId, id: req.params.id });
  await prisma.thing.delete({ where: { id: thing.id } });
  res.end();
});

app.listen(3000);
module.exports = app;

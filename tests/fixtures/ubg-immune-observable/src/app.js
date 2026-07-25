// Innate immunity for O4 (ADR-072). O4 (IRREVERSIBLE_OBSERVABLE) fires when a route makes an
// observable external call AND mutates state with no compensation. The immune refinement: only a
// KNOWN-dangerous effect from the PAMP catalog (`sdk:` — payment/mail/… you cannot undo) is a HARD
// finding; a GENERIC external call (an unknown fetch — in the wild almost always a read) is
// TOLERATED as an advisory, not cried-wolf. Attack the known pathogen, tolerate the unfamiliar.
import express from 'express';
import axios from 'axios';
import Stripe from 'stripe';
const stripe = new Stripe('k');
const app = express();
app.use(express.json());
const db = { order: { create: async () => null }, log: { create: async () => null } };

// KNOWN-dangerous: a Stripe charge (you cannot un-charge) + a write, no compensation → HARD.
app.post('/pay', async (req, res) => {
  await stripe.charges.create({ amount: req.body.amount });
  await db.order.create({ data: req.body });
  res.json({ ok: true });
});

// GENERIC external call: an unknown API fetch + a write → ADVISORY (surfaced, not a hard cry-wolf).
app.post('/enrich', async (req, res) => {
  await axios.post('https://api.example.com/enrich', req.body);
  await db.log.create({ data: req.body });
  res.json({ ok: true });
});

app.listen(3000);

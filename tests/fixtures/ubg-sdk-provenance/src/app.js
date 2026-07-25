// Import-provenance: a binding imported from an effect package (@sendgrid/mail) or built from one
// (stripe factory) is recognized as an external effect by ORIGIN — so the bare `.send()` the path
// catalog can't key on is still caught. A read-shaped method stays a GET (not observable). A
// binding from a non-effect package (lodash) never fires.
import express from 'express';
import sgMail from '@sendgrid/mail';
import Stripe from 'stripe';
import _ from 'lodash';
const app = express();
app.use(express.json());
const stripe = Stripe(process.env.KEY); // factory idiom → labeled by provenance
const prisma = { log: { create: async () => null } };

app.post('/notify', async (req, res) => {
  await sgMail.send({ to: req.body.to }); // bare .send — provenance, observable
  await prisma.log.create({ data: {} });
  const cleaned = _.pick(req.body, ['to']); // lodash — must NOT be an effect
  res.json({ cleaned });
});

app.get('/customer/:id', async (req, res) => {
  const c = await stripe.customers.retrieve(req.params.id); // read → GET, not observable
  res.json(c);
});

app.listen(3000);

const express = require('express');
const { db } = require('./db');
const { User, Product } = require('./models');
const app = express();
app.use(express.json());

function requireAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).end();
  next();
}

// drizzle write, guarded → clean
app.post('/orders', requireAuth, async (req, res) => {
  await db.insert(orders).values(req.body);
  res.status(201).json({ ok: true });
});

// sequelize write, UNGUARDED → a real finding
app.post('/products', async (req, res) => {
  await Product.bulkCreate(req.body.items);
  res.status(201).json({ ok: true });
});

// typeorm active-record read
app.get('/users/:id', async (req, res) => {
  const u = await User.findOneBy({ id: req.params.id });
  res.json({ u });
});

app.listen(3000);
module.exports = app;

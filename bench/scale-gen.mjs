// bench/scale-gen.mjs — generate a synthetic Express app of arbitrary size, in
// the shape that used to make reachability quadratic: ONE global middleware
// (fan-out = route count) in front of N routers × M routes.
//   node bench/scale-gen.mjs <outDir> <routers> <routesPerRouter>
import fs from 'node:fs';
import path from 'node:path';

const [outDir, nRouters = 20, nRoutes = 25] = process.argv.slice(2);
const R = Number(nRouters);
const N = Number(nRoutes);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'src', 'routes'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'prisma'), { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: 'scale-app',
      private: true,
      main: 'src/app.js',
      dependencies: { express: '^4.21.0', '@prisma/client': '^5.20.0' },
    },
    null,
    2,
  ),
);

// FK edges so consistency-domains / O3 / O5 actually have work to do
let schema = 'datasource db { provider = "postgresql"\n url = env("DB") }\n';
for (let t = 0; t < 12; t++) {
  schema += `model T${t} {\n  id String @id\n  userId String\n  ownerId String\n  amount Int\n`;
  if (t > 0)
    schema += `  parent T${t - 1} @relation(fields: [parentId], references: [id])\n  parentId String\n`;
  schema += '}\n';
}
fs.writeFileSync(path.join(outDir, 'prisma', 'schema.prisma'), schema);

const app = [
  `const express = require('express');`,
  `const app = express();`,
  `app.use(express.json());`,
  `function requireAuth(req, res, next) {`,
  `  if (!req.headers.authorization) return res.status(401).json({ error: 'nope' });`,
  `  next();`,
  `}`,
  `app.use(requireAuth);`,
];
for (let r = 0; r < R; r++) app.push(`app.use('/r${r}', require('./routes/r${r}'));`);
app.push(`app.listen(3000);`, `module.exports = app;`);
fs.writeFileSync(path.join(outDir, 'src', 'app.js'), app.join('\n'));

for (let r = 0; r < R; r++) {
  const lines = [
    `const express = require('express');`,
    `const { PrismaClient } = require('@prisma/client');`,
    `const prisma = new PrismaClient();`,
    `const router = express.Router();`,
  ];
  for (let i = 0; i < N; i++) {
    const t = (r + i) % 12;
    lines.push(
      `router.post('/p${i}', async (req, res) => {`,
      `  const { amount } = req.body;`,
      `  await prisma.t${t}.create({ data: { amount, userId: req.body.userId } });`,
      `  await prisma.t${(t + 1) % 12}.update({ where: { id: req.params.id }, data: { amount } });`,
      `  res.json({ ok: true });`,
      `});`,
      `router.get('/g${i}', async (req, res) => {`,
      `  const rows = await prisma.t${t}.findMany({ where: { userId: req.query.u } });`,
      `  res.json(rows);`,
      `});`,
    );
  }
  lines.push(`module.exports = router;`);
  fs.writeFileSync(path.join(outDir, 'src', 'routes', `r${r}.js`), lines.join('\n'));
}

console.log(`generated ${outDir}: ${R} routers × ${N * 2} routes = ${R * N * 2} routes`);

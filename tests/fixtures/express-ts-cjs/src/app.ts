import express = require('express');
const usersRouter = require('./routes/users');

const app = express();
app.use(express.json());

/** Health check CJS TS */
app.get('/health', (req: any, res: any) => res.json({ status: 'ok' }));

app.use('/api/users', usersRouter);

app.listen(8081, () => {
  console.log('TS CJS listening');
});

const express = require('express');
const usersRouter = require('./routes/users.js');

const app = express();
app.use(express.json());

/** Health check CJS */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/users', usersRouter);

app.listen(3457, () => console.log('CJS app listening on port 3457'));

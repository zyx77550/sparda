// CQRS receiver disambiguation — a capitalized `.create()` is a MODEL write only when the
// receiver is a model. `SomeCommand.create(...)` / `SomeQuery.create(...)` construct a
// command object and touch no database; they must NOT read as db_writes (novu had 612 of
// these phantom writes). A real model (`User`) still writes.
const express = require('express');
const { CommandBus } = require('@nestjs/cqrs');
const { User } = require('./models');
const { RegisterUserCommand } = require('./commands');

const app = express();
app.use(express.json());
const bus = new CommandBus();

app.post('/register', async (req, res) => {
  // CQRS: a command factory — NOT a database write
  const command = RegisterUserCommand.create({ email: req.body.email });
  await bus.execute(command);
  // the ONE real write on this route: the Mongoose model
  await User.create({ email: req.body.email });
  res.status(201).json({ ok: true });
});

app.listen(4602);
module.exports = app;

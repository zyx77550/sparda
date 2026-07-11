-- Lifecycle fixture: one table whose declared CHECK names a state machine.
-- pending → paid → refunded. The stateful mirror derives the whole lifecycle
-- from this DDL + the INSERT/UPDATE literals in app.js — nothing is guessed.
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded'))
);

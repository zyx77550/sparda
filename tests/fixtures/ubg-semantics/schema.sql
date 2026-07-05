-- SBIR v1.1 fixture schema: invariants, FK ownership chain, standalone table.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  balance DECIMAL(10,2) DEFAULT 0 CHECK (balance >= 0)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded')),
  CHECK (amount >= 0)
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  qty INTEGER DEFAULT 1
);

CREATE TABLE logs (
  id BIGSERIAL PRIMARY KEY,
  message TEXT
);

-- UBG FastAPI fixture schema: one table the code touches, one orphan.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

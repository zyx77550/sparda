CREATE TABLE users ( id SERIAL, email VARCHAR(255) );
CREATE TABLE authenticators ( id SERIAL, user_id INTEGER, secret VARCHAR(255) );
CREATE TABLE webhooks ( id SERIAL, url VARCHAR(255) );

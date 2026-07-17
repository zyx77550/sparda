const express = require('express');

function createApp() {
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));
  return app;
}

module.exports = createApp;

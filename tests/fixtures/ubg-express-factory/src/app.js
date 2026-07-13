const express = require('express');
const thingsRouter = require('./controllers/things');
const adminRouter = require('./controllers/admin');

function createApp({ enableAdmin } = {}) {
  const app = express();
  app.use(express.json());

  app.use('/things', thingsRouter);

  if (enableAdmin) {
    app.use('/admin', adminRouter);
  }

  return app;
}

const app = createApp({ enableAdmin: true });
app.listen(3000);
module.exports = createApp;

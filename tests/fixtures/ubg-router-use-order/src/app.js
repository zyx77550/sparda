import express from 'express';
import admin from './admin.js';
const app = express();
app.use('/admin', admin);
app.listen(4808);
export default app;

import express from 'express';
import itemsRouter from './items.routes.js';
const app = express();
app.use(express.json());
app.use('/items', itemsRouter);
app.listen(3000);

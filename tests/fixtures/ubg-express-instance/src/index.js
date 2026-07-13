import express from 'express';
import thingsRouter from './things.routes.js';

const app = express();
app.use(express.json());
app.use('/things', thingsRouter);

app.listen(3000);

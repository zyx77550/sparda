import express, { Request, Response } from 'express';
import { usersRouter } from './routes/users.js';
import { z } from 'zod';

const app = express();
app.use(express.json());

/** Get current system health status. */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/** Create a validation token using zod schema. */
app.post('/validate', (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email(),
    token: z.string(),
  });
  const data = schema.parse(req.body);
  res.json({ valid: true, data });
});

app.use('/api/users', usersRouter);

app.listen(8080, () => {
  console.log('TS ESM listening');
});

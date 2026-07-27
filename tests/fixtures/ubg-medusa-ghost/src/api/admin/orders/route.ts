// The verb IS exported — Medusa serves POST /admin/orders — but the handler is a
// member of an imported registry, so its body never resolves. The route must be
// DECLARED, never dropped.
import { handlers } from '../../../lib/handlers';

export const POST = handlers.createOrder;

export async function GET(req: any, res: any) {
  res.json({ orders: [] });
}

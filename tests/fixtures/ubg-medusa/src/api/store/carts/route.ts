import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createCartWorkflow } from "@medusajs/core-flows";

// UNAUTHENTICATED — the opt-out convention
export const AUTHENTICATE = false;

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await createCartWorkflow(req.scope).run({ input: req.body });
  res.status(201).json({ cart: result });
};

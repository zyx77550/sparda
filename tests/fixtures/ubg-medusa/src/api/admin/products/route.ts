import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createProductWorkflow } from "@medusajs/core-flows";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ products: [] });
};

// authenticated by default (admin) — a create workflow mutates
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await createProductWorkflow(req.scope).run({ input: req.body });
  res.status(201).json({ product: result });
};

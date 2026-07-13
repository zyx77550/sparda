import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { deleteProductWorkflow } from "@medusajs/core-flows";

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteProductWorkflow(req.scope).run({ input: { id: req.params.id } });
  res.status(200).json({ deleted: true });
};

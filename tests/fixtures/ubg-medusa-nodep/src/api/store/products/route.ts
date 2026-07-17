// A Medusa file-route in a repo that does NOT list any @medusajs dep (the framework's own
// packages, and the corpus `packages/medusa` clone: @medusajs/framework is a devDep, express
// is a runtime dep). Detection must key off the structural signature, not a dep — otherwise
// the express dep misroutes this to a 1-route express app (E-043).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({ products: [] });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(201).json({ ok: true });
};

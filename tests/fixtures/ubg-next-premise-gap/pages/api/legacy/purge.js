// The Pages Router, still served by Next 14 side by side with the App Router. SPARDA has
// no lowering for it, so this endpoint is not in the graph, not in the blind-spot ledger,
// and not in any skip: it does not exist for the analysis. Only the premise oracle can
// state that the app has surface the proof never covered.
export default async function handler(req, res) {
  await db.orders.deleteMany({ where: { archived: true } });
  res.json({ ok: true });
}

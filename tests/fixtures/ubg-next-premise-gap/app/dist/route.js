// `dist` is an ordinary URL segment under app/ — Next serves this at /dist. The
// extractor's directory walk excludes it as a build folder, so the endpoint is neither
// modelled nor declared: it does not exist for SPARDA. Only an oracle that enumerates
// the conventions independently can see it.
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  await db.orders.deleteMany({ where: { tenant: searchParams.get('tenant') } });
  return Response.json({ ok: true });
}

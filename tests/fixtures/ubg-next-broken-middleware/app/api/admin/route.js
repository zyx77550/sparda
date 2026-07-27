export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  await db.users.deleteMany({ where: { tenant: searchParams.get('tenant') } });
  return Response.json({ ok: true });
}

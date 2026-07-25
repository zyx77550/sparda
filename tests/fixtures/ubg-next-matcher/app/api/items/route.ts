// /api/items — the matcher `/dashboard/:path*` does NOT cover this path, so the
// middleware never runs here. Crediting it as a guard would be the false PROVEN
// (E-NEXT-MW). This mutation is genuinely UNGUARDED and MUST flag.
import { prisma } from '@/lib/prisma';

export async function DELETE(req) {
  const { id } = await req.json();
  await prisma.user.delete({ where: { id } }); // any client can delete any user
  return Response.json({ ok: true });
}

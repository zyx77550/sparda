// /dashboard — the matcher `/dashboard/:path*` covers this path, so the denying
// middleware IS a real guard here. This mutation should NOT flag as unguarded.
import { prisma } from '@/lib/prisma';

export async function POST(req) {
  const { id } = await req.json();
  await prisma.user.update({ where: { id }, data: { seen: true } });
  return Response.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
export async function POST(req: Request) {
  const body = await req.json();
  if (body.admin) {
    const denied = await requireAuth(req);
    if (denied) return denied;
  } else {
    await prisma.charge.create({ data: { amount: body.amount } }); // BYPASS: else branch has no guard
  }
  return NextResponse.json({ ok: true });
}

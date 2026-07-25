import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
export async function POST(req: Request) {
  const body = await req.json();
  if (body.go) {
    const denied = await requireAuth(req);
    if (denied) return denied;
    await prisma.charge.create({ data: { amount: body.amount } });
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { verifySignature } from '@/lib/verifySignature';

const prisma = { job: { create: async (_: any) => null } } as any;

// A plain handler that gates itself inline — no wrapper. `verifySignature` provably
// denies (401) before the write, so this must NOT flag as an unguarded mutation.
export async function POST(req: NextRequest) {
  await verifySignature(req);
  await prisma.job.create({ data: await req.json() });
  return NextResponse.json({ ok: true }, { status: 201 });
}

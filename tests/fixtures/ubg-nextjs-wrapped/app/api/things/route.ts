import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/withAuth';

const prisma = { thing: { create: async () => null } } as any;

// the real handler is a local function wrapped by a higher-order function
async function postHandler(req: NextRequest) {
  await prisma.thing.create({ data: await req.json() });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export const POST = withAuth(postHandler);

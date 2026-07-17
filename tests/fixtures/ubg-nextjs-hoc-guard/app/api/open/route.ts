import { NextRequest, NextResponse } from 'next/server';

const prisma = { note: { create: async (_: any) => null } } as any;

// A genuinely OPEN mutation — no wrapper, no guard. This must still flag, proving the
// HOC recognition suppresses false positives without hiding real unguarded writes.
export async function POST(req: NextRequest) {
  await prisma.note.create({ data: await req.json() });
  return NextResponse.json({ ok: true }, { status: 201 });
}

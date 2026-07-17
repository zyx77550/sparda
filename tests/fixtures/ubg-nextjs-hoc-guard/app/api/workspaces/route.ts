import { NextResponse } from 'next/server';
import { withWorkspace } from '@/lib/withWorkspace';

const prisma = { workspace: { create: async (_: any) => null } } as any;

// A mutation gated only by the HOC — no inline guard. SPARDA must recognise
// withWorkspace as a verified guard, or this reads as a false UNGUARDED_MUTATION.
export const POST = withWorkspace(async ({ req }) => {
  await prisma.workspace.create({ data: await req.json() });
  return NextResponse.json({ ok: true }, { status: 201 });
});

// verb alias — PUT reuses POST's wrapped handler. The wrapper (guard) must carry
// through the alias, or PUT reads as unguarded on byte-identical behavior.
export const PUT = POST;

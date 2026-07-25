import { NextResponse } from 'next/server';
// A credited guard: reads a credential and can refuse with 401.
export async function requireAuth(req: Request) {
  if (!req.headers.get('authorization')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

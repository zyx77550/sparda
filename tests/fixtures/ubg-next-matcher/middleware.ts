// A denying middleware scoped by `config.matcher` to the /dashboard subtree ONLY.
// It runs on /dashboard/* and never on /api/* — so it may be credited as a guard on
// /dashboard routes, but crediting it on /api routes would be a FALSE PROVEN (E-NEXT-MW).
import { NextResponse } from 'next/server';

export function middleware(req) {
  const token = req.cookies.get('token');
  if (!token) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*'] };

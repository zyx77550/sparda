// This file is the app's ONLY global gate — and it does not parse. Every route below
// then reads as ungated (noise) or, worse, as clean under a protection SPARDA never
// verified. Losing it must be declared at a risk that bars PROVEN.
export function middleware(request) {
  if (!request.headers.get('authorization') {
    return new Response('no', { status: 401 });
  }
}

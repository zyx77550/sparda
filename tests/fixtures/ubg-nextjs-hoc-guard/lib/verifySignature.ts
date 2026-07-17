import { NextRequest } from 'next/server';

class ApiError extends Error {
  code: string;
  constructor(opts: { code: string }) {
    super(opts.code);
    this.code = opts.code;
  }
}

// A bare auth verifier called inline at the top of a plain handler — throws an
// unauthorized error when the signature is missing. The deny is a bare call one hop
// away from the handler (dub's cron `verifyQstashSignature` shape).
export function verifySignature(req: NextRequest) {
  if (!req.headers.get('x-signature')) {
    throw new ApiError({ code: 'unauthorized' });
  }
}

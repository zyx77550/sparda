import { NextRequest, NextResponse } from 'next/server';

// A dub-shaped error class: a `{ code: "unauthorized" | "forbidden" }` error shape maps
// to 401/403 downstream. Constructing one is a provable denial.
class ApiError extends Error {
  code: string;
  constructor(opts: { code: string; message?: string }) {
    super(opts.message ?? opts.code);
    this.code = opts.code;
  }
}

type Handler = (ctx: { req: NextRequest; workspace: any }) => Promise<Response>;

// The HOC that authenticates every route it wraps. The deny lives in the RETURNED inner
// function — SPARDA must deep-scan into it to prove the wrapper can reject.
export const withWorkspace = (handler: Handler) => {
  return async (req: NextRequest) => {
    const token = req.headers.get('authorization');
    if (!token) {
      throw new ApiError({ code: 'unauthorized' });
    }
    const workspace = { id: 'ws_1' };
    return handler({ req, workspace });
  };
};

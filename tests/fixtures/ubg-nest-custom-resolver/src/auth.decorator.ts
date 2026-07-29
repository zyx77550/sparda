import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// twenty's auth idiom: principal injection. An ASSERTED guard (ADR-063) — it proves the
// route CONSUMES auth, never that it DENIES — which is why the saga hole below is the
// finding that survives, exactly as on the real app.
export const AuthWorkspace = createParamDecorator((data, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().workspace;
});

import { CanActivate, ExecutionContext, HttpException } from '@nestjs/common';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';
// Ghostfolio's real permission guard: the deny is thrown with a NAMED status constant
// (`StatusCodes.FORBIDDEN`), never a numeric 403. Before ADR-073 SPARDA only recognized
// numeric 401/403, so this read `asserted` — capping every app that guards this way at
// PARTIAL. The named constant is a conserved denial signal (FORBIDDEN *is* 403), so it now
// reads VERIFIED.
export class HasPermissionGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    const allowed = false;
    if (!allowed) {
      throw new HttpException(getReasonPhrase(StatusCodes.FORBIDDEN), StatusCodes.FORBIDDEN);
    }
    return true;
  }
}

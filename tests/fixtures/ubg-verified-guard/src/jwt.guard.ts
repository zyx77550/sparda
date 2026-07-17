import { Injectable, UnauthorizedException } from '@nestjs/common';

// A REAL guard: its canActivate can DENY (throws 401). SPARDA should resolve this
// and mark the guard VERIFIED — proven able to deny, not merely trusted by name.
@Injectable()
export class JwtGuard {
  canActivate(context: any): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.user) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

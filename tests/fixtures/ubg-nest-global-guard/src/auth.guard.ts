import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, SetMetadata, applyDecorators } from '@nestjs/common';

// The custom auth decorator — like immich's @Authenticated. It only sets metadata; the
// GLOBAL guard below reads it and enforces. No @UseGuards here, so a per-method scan sees
// only the name, never the deny.
export const Authenticated = () => applyDecorators(SetMetadata('authRoute', true));

@Injectable()
export class AuthService {
  // the deny lives HERE, one DI hop below canActivate
  async authenticate(headers: Record<string, string>) {
    if (!headers.authorization) {
      throw new UnauthorizedException('no session');
    }
    return { userId: 'u1' };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // delegates the rejection to the service — the canActivate body itself never throws
    req.user = await this.authService.authenticate(req.headers);
    return true;
  }
}

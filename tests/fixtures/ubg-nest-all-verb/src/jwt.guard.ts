import { AuthGuard } from '@nestjs/passport';
// a plain subclass of the passport guard — provably 401s (no override) → VERIFIED
export class JwtAuthGuard extends AuthGuard('jwt') {}
// overrides handleRequest to swallow the error → does NOT deny → must stay ASSERTED
export class SoftGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) { return user; }
}

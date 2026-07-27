import { applyDecorators, UseGuards, SetMetadata } from '@nestjs/common';
import { SessionAuthGuard } from './session.guard';
import { isEnterprise } from './config';

// NestJS's OFFICIAL composition API, and novu's exact shape: a house decorator declared
// once and applied on 340 routes. SPARDA matched `@RequireAuthentication` on its NAME and
// stopped — the symbol is a FUNCTION, and guard resolution only knew how to open a CLASS.
export function RequireAuthentication() {
  return applyDecorators(UseGuards(SessionAuthGuard));
}

// The same, with a runtime branch whose returned decorator SPARDA cannot read (novu's
// enterprise edition lives in a package whose source is not in the repository). The
// readable branch's guard is credited — that is a true statement about the configuration
// SPARDA read — and the unread branch is DECLARED at high risk, so the app cannot reach
// PROVEN on the strength of a configuration nobody opened.
export function RequireAuthenticationEE() {
  if (isEnterprise()) {
    const { EERequire } = require('@acme/ee-auth');

    return EERequire();
  }

  return applyDecorators(UseGuards(SessionAuthGuard));
}

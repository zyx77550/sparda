// Custom principal-injection param decorators — twenty's real auth idiom. They read the
// authenticated principal off the request context (populated upstream by the framework's
// auth layer). SPARDA does not need to resolve their bodies; their PRESENCE on a route
// method's parameters is the asserted auth signal.
import { createParamDecorator } from '@nestjs/common';

export const AuthWorkspace = createParamDecorator((_data, ctx) => {
  return ctx.switchToHttp().getRequest().workspace;
});

export const GetUser = createParamDecorator((_data, ctx) => {
  return ctx.switchToHttp().getRequest().user;
});

// A DECOY: @Author injects a post's author entity, NOT the authenticated principal — its name
// merely starts with "auth". It must NOT be read as a guard (that would hide a real hole).
export const Author = createParamDecorator((_data, ctx) => {
  return ctx.switchToHttp().getRequest().body.author;
});

// The RECALL case a name-match can never catch: @Whoami has NO auth token in its name, yet its
// body reads the authenticated principal (request.user). Behaviour proves it IS a guard.
export const Whoami = createParamDecorator((_data, ctx) => {
  return ctx.switchToHttp().getRequest().user;
});

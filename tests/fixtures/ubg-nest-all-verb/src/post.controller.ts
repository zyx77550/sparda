// The Nest twin of E-067. `@All()` is a real @nestjs/common decorator answering EVERY
// verb; it was not in the modelled vocabulary, so an unguarded mass-mutation endpoint
// was invisible while the clean decoy carried the app to a bare PROVEN.
// `@Options`/`@Head` were missing too, and a non-literal decorator path silently
// mounted the route at the controller prefix — a MISPLACED route, not a lost one.
import { Controller, Post, All, Options, Get, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PostService } from './post.service';

const ROUTES = { detail: 'detail/:id' };

@Controller('posts')
export class PostController {
  constructor(private svc: PostService) {}

  // decoy: guarded by a catalog-verified passport guard
  @Post('inline')
  @UseGuards(AuthGuard('jwt'))
  async a(@Body() b: any) { return this.svc.update(b); }

  // payload: every verb, no guard
  @All('wipe')
  async wipe(@Body() b: any) { return this.svc.update(b); }

  // a safe method must NOT read as a mutation just because it is not GET
  @Options('cors')
  async preflight() { return null; }

  // a path SPARDA cannot read — declared, not guessed
  @Get(ROUTES.detail)
  async detail() { return null; }
}

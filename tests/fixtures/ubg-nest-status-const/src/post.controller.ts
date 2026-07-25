import { Controller, Post, Body, UseGuards } from '@nestjs/common';
// imported through a tsconfig `paths` alias (`@app/*` -> `src/*`) — the shape ghostfolio
// and every Nx monorepo use. Resolving the alias is what lets guardScan reach the
// canActivate above; without it the class dead-ends and the guard stays asserted.
import { HasPermissionGuard } from '@app/guards/perm.guard';
import { PostService } from './post.service';

@Controller('posts')
export class PostController {
  constructor(private svc: PostService) {}

  @Post()
  @UseGuards(HasPermissionGuard)
  async create(@Body() b: any) { return this.svc.update(b); }
}

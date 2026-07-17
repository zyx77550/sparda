import { Controller, Post, Body } from '@nestjs/common';
import { Authenticated } from './auth.guard';

class CatsRepo {
  async save(_: any) {}
}

@Controller('cats')
export class CatsController {
  private repo = new CatsRepo();

  // guarded ONLY by the app-wide AuthGuard, triggered by @Authenticated's metadata.
  // Its guard must read VERIFIED — the global guard is proven to deny.
  @Post()
  @Authenticated()
  async create(@Body() dto: any) {
    await this.repo.save(dto);
    return { ok: true };
  }
}

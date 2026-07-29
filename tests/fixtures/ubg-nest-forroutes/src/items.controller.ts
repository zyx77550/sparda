import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly svc: ItemsService) {}

  // public read — no mutation, no guard obligation.
  @Get()
  async list() {
    return [];
  }

  // Guarded by AuthMiddleware via forRoutes { path: 'items/:id', method: POST }. It carries
  // NO guard decorator, so a per-controller scan alone reads this write as UNGUARDED — the
  // false critical this feature removes. AuthMiddleware.use() provably denies, so the route
  // reads PROVEN, not merely asserted.
  @Post(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.svc.update({ id, ...dto });
  }

  // Bound ONLY to LoggerMiddleware via forRoutes { path: 'items/:id', method: DELETE }. A
  // logger proves no deny and reads nothing like a guard, so this destructive mutation must
  // STILL flag — forRoutes coverage alone never softens a critical.
  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.svc.remove(id);
  }

  // AuthMiddleware is bound to the LITERAL path 'items/draft' (PUT), which does NOT cover this
  // route ('items/publish') — a different literal segment. The matcher must not over-cover, so
  // this write STAYS flagged. (The strict-path invariant that keeps DELETE /users/:slug flagged
  // on the real nestjs-realworld app.)
  @Put('publish')
  publish(@Body() dto: any) {
    return this.svc.publish(dto);
  }
}

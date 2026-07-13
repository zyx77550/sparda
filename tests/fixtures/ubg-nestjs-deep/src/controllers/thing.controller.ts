import { Controller, Post, Body } from '@nestjs/common';
import { Authenticated } from 'src/middleware/auth.guard';
import { ThingService } from 'src/services/thing.service';

@Controller('things')
export class ThingController {
  constructor(private service: ThingService) {}

  // guarded by a custom decorator (not @UseGuards) — must NOT be flagged
  @Post()
  @Authenticated({ permission: 'thing.create' })
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  // no guard decorator anywhere — a genuine unguarded mutation
  @Post('public')
  createPublic(@Body() dto: any) {
    return this.service.create(dto);
  }
}

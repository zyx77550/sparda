import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { NoopGuard } from './noop.guard';
import { CatsService } from './cats.service';

@Controller('cats')
export class CatsController {
  constructor(private svc: CatsService) {}

  @Post('secure')
  @UseGuards(JwtGuard)
  secure(@Body() data: any) {
    return this.svc.create(data);
  }

  @Post('weak')
  @UseGuards(NoopGuard)
  weak(@Body() data: any) {
    return this.svc.create(data);
  }
}

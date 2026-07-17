import { Controller, Get, Post, Body } from '@nestjs/common';
import { CatsService } from './cats.service';

@Controller('cats')
export class CatsController {
  constructor(private svc: CatsService) {}

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Post()
  create(@Body() data: any) {
    return this.svc.create(data);
  }
}

import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CatsService } from './cats.service';
import { AuthGuard } from '../auth.guard';

@Controller('cats')
export class CatsController {
  constructor(private catsService: CatsService) {}

  @Get()
  findAll() {
    return this.catsService.findAll();
  }

  @Post()
  create(@Body() data: any) {
    return this.catsService.create(data);
  }

  @Post('admin')
  @UseGuards(AuthGuard)
  adminCreate(@Body() data: any) {
    return this.catsService.create(data);
  }
}

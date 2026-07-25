import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard, SoftGuard } from './jwt.guard';
import { PostService } from './post.service';

@Controller('posts')
export class PostController {
  constructor(private svc: PostService) {}

  @Post('inline')
  @UseGuards(AuthGuard('jwt'))
  async a(@Body() b: any) { return this.svc.update(b); }

  @Post('subclass')
  @UseGuards(JwtAuthGuard)
  async b(@Body() b: any) { return this.svc.update(b); }

  @Post('soft')
  @UseGuards(SoftGuard)
  async c(@Body() b: any) { return this.svc.update(b); }
}

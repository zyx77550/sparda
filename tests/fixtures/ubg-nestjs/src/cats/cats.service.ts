import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CatsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.cat.findMany();
  }

  create(data: any) {
    return this.prisma.cat.create({ data });
  }
}

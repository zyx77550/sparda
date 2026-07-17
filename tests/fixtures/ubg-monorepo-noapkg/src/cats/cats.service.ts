import { Injectable } from '@nestjs/common';

@Injectable()
export class CatsService {
  prisma: any;
  findAll() {
    return this.prisma.cat.findMany();
  }
  create(data: any) {
    return this.prisma.cat.create({ data });
  }
}

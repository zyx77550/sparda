import { Injectable } from '@nestjs/common';
@Injectable()
export class CatsService {
  prisma: any;
  create(data: any) {
    return this.prisma.cat.create({ data });
  }
}

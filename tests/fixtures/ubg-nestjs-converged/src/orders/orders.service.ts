import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  prisma: any;

  create(dto: any) {
    return this.persist(dto);
  }

  persist(dto: any) {
    return this.prisma.order.create({ data: dto });
  }
}

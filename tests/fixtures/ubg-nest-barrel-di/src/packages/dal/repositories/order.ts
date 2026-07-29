import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderRepository {
  constructor(private prisma: any) {}

  // the route's REAL behavior: two writes, reachable only through the barrel
  async purge(tenant: string) {
    await this.prisma.order.deleteMany({ where: { tenant } });
    return this.prisma.orderArchive.create({ data: { tenant } });
  }

  async list(tenant: string) {
    return this.prisma.order.findMany({ where: { tenant } });
  }
}

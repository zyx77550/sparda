import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  constructor(private prisma: any) {}

  async create(data: any) {
    return this.prisma.order.create({ data });
  }

  async remove(id: string) {
    return this.prisma.order.delete({ where: { id } });
  }

  async archive(data: any) {
    return this.prisma.order.updateMany({ where: { tenant: data.tenant }, data: { archived: true } });
  }
}

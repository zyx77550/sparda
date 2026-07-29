import { Controller, Post, Get, Body, Param } from '@nestjs/common';
// the workspace-package import: it lands on a BARREL, not on a class declaration
import { OrderRepository, AuditRepository } from './packages/dal';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private orders: OrderRepository,
    private audit: AuditRepository,
    private service: OrdersService,
  ) {}

  // one hop, straight through the barrel: deleteMany + create live in OrderRepository
  @Post('purge/:tenant')
  purge(@Param('tenant') tenant: string) {
    return this.orders.purge(tenant);
  }

  // TWO hops — a local service that itself injects a barrelled repository. The barrel
  // must be crossed at depth, not only from the controller.
  @Post('rotate/:tenant')
  rotate(@Param('tenant') tenant: string) {
    return this.service.rotate(tenant);
  }

  @Get(':tenant')
  list(@Param('tenant') tenant: string) {
    return this.orders.list(tenant);
  }
}

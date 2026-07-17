import { Controller, Post, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { AuditLog } from './audit.log';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  create(@Body() dto: any) {
    return this.ordersService.create(dto);
  }

  @Post('audit')
  audit(@Body() entry: any) {
    const audit = new AuditLog();
    return audit.record(entry);
  }
}

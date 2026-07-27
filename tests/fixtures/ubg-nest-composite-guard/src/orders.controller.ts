import { Controller, Post, Delete, Body, Param } from '@nestjs/common';
import { RequireAuthentication, RequireAuthenticationEE } from './auth.decorator';
// through a BARREL, exactly as a workspace package arrives (`export * from './x'`)
import { RequirePermissions } from './decorators';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  // the composite resolves to a guard that provably 401s → VERIFIED, not asserted
  @RequireAuthentication()
  @Post()
  create(@Body() body: any) {
    return this.ordersService.create(body);
  }

  // readable branch credited, unread branch declared
  @RequireAuthenticationEE()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(id);
  }

  // ONLY a metadata tag, and this app registers no global guard — so this route is not
  // protected by anything SPARDA can see, and must stop reading as guarded
  @RequirePermissions('orders:write')
  @Post('archive')
  archive(@Body() body: any) {
    return this.ordersService.archive(body);
  }
}

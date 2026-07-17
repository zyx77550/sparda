import { RestController, Get, Post } from '../framework/decorators';
import { ThingService } from '../services/thing.service';

@RestController('/things')
export class ThingsController {
  constructor(private service: ThingService) {}

  @Get('/')
  list() {
    return this.service.findAll();
  }

  // guarded-by-default (the registry authenticates) → must NOT be flagged
  @Post('/')
  create(body: any) {
    return this.service.create(body);
  }

  // opt-out of the registry auth → genuinely public write → MUST be flagged
  @Post('/import', { skipAuth: true })
  publicImport(body: any) {
    return this.service.create(body);
  }
}

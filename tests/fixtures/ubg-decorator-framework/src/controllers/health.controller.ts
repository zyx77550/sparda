import { RestController, Get } from '../framework/decorators';

@RestController('/health')
export class HealthController {
  @Get('/')
  check() {
    return { ok: true };
  }
}

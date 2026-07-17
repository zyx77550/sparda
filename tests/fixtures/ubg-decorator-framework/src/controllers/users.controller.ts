import { RestController, Get } from '../framework/decorators';

@RestController('/users')
export class UsersController {
  @Get('/')
  list() {
    return [];
  }
}

import { NestMiddleware, Injectable } from '@nestjs/common';

// A middleware that gates nothing — it only calls next(). Bound to a mutation via
// forRoutes, it must NOT soften that route's UNGUARDED critical.
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: any, res: any, next: any) {
    next();
  }
}

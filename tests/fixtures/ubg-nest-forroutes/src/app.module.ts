import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { AuthMiddleware } from './auth.middleware';
import { LoggerMiddleware } from './logger.middleware';

@Module({
  controllers: [ItemsController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // A proven-denying guard, bound by path+method — proves POST /items/:id.
    consumer
      .apply(AuthMiddleware)
      .forRoutes({ path: 'items/:id', method: RequestMethod.POST });
    // A non-guard middleware on the DELETE — must not soften it.
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: 'items/:id', method: RequestMethod.DELETE });
    // A guard bound to a DIFFERENT literal path — must not over-cover PUT /items/publish.
    consumer
      .apply(AuthMiddleware)
      .forRoutes({ path: 'items/draft', method: RequestMethod.PUT });
  }
}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, AuthService } from './auth.guard';
import { CatsController } from './cats.controller';

@Module({
  controllers: [CatsController],
  providers: [
    AuthService,
    // the app-wide guard — gates every route, invisible to a per-method decorator scan
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

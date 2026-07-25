import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
@Module({ controllers: [UserController], providers: [UserService] })
class AppModule {}
async function bootstrap(){ const app = await NestFactory.create(AppModule); await app.listen(3000); }
bootstrap();

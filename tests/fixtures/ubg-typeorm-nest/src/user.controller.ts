import { Controller, Post, Delete, Body, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { UserService } from "./user.service";
@Controller("users")
export class UserController {
  constructor(private readonly svc: UserService) {}
  @Post()
  @UseGuards(AuthGuard())
  create(@Body() dto: any) { return this.svc.create(dto); }
  @Delete(":id")
  remove(@Param("id") id: number) { return this.svc.remove(id); }
}

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./user.entity";
@Injectable()
export class UserService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}
  async create(dto: any) { return this.repo.save(dto); }
  async remove(id: number) { return this.repo.delete(id); }
}

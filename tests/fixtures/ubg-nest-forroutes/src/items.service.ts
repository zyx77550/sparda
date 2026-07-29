import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from './item.entity';

@Injectable()
export class ItemsService {
  constructor(@InjectRepository(Item) private readonly repo: Repository<Item>) {}
  async update(dto: any) {
    return this.repo.save(dto);
  }
  async remove(id: number) {
    return this.repo.delete(id);
  }
  async publish(dto: any) {
    return this.repo.save({ ...dto, published: true });
  }
}

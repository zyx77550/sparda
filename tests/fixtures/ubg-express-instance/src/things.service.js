import { BaseService } from './base.service.js';

export class ThingsService extends BaseService {
  async createOne(data) {
    const stamped = { ...data, createdAt: Date.now() };
    return super.createOne(stamped);
  }
}

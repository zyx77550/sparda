import { Injectable } from '@nestjs/common';
import { AuditRepository } from './packages/dal';

@Injectable()
export class OrdersService {
  constructor(private audit: AuditRepository) {}

  async rotate(tenant: string) {
    return this.audit.record(`rotate:${tenant}`);
  }
}

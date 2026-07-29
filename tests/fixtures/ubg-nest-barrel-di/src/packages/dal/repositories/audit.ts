import { Injectable } from '@nestjs/common';

@Injectable()
export class AuditRepository {
  constructor(private prisma: any) {}

  async record(action: string) {
    return this.prisma.auditLog.create({ data: { action } });
  }
}

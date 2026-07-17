export class AuditLog {
  prisma: any;

  record(entry: any) {
    return this.prisma.audit_log.create({ data: entry });
  }
}

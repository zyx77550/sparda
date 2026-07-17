export class ThingService {
  prisma: any;
  findAll() {
    return this.prisma.thing.findMany();
  }
  create(data: any) {
    return this.prisma.thing.create({ data });
  }
}

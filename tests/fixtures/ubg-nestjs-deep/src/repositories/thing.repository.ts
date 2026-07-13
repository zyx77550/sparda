import { Kysely } from 'kysely';

export class ThingRepository {
  constructor(private db: Kysely<any>) {}

  // the real effect — two DI hops below the controller, behind a Kysely builder
  insert(dto: any) {
    return this.db.insertInto('things').values(dto).returningAll().executeTakeFirstOrThrow();
  }
}

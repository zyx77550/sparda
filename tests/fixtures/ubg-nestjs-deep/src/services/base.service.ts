import { ThingRepository } from 'src/repositories/thing.repository';

// the inherited-DI pattern: repositories injected in the base constructor
export class BaseService {
  constructor(protected thingRepository: ThingRepository) {}
}

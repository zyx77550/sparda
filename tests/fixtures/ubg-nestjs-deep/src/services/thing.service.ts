import { BaseService } from 'src/services/base.service';

export class ThingService extends BaseService {
  // uses an inherited dependency — resolvable only by climbing `extends`
  create(dto: any) {
    return this.thingRepository.insert(dto);
  }
}

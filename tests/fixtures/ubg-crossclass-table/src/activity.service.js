import { ItemsService } from './base.service.js';

// A subclass that fixes its table via super() with a LITERAL — must resolve to the
// concrete table 'directus_activity', NOT a symbol.
export class ActivityService extends ItemsService {
  constructor(options = {}) {
    super('directus_activity', options);
  }
}

import { Injectable } from '@nestjs/common';

// A guard that CANNOT deny — canActivate always returns true. SPARDA must NOT mark it
// verified (it stays asserted: present by name, but no proven deny path).
@Injectable()
export class NoopGuard {
  canActivate(): boolean {
    return true;
  }
}

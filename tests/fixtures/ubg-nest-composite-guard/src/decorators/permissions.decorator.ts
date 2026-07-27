import { SetMetadata } from '@nestjs/common';

// NOT a guard: a metadata tag some guard reads elsewhere. Reached only through the barrel
// below — the monorepo shape, where a workspace package exports everything from an
// `index.ts` that declares nothing itself.
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata('permissions', perms);

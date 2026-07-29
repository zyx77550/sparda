import { Resolver } from '@nestjs/graphql';

// A house brand around @Resolver — twenty registers 54 of its resolvers this way and
// exactly ONE with the bare `@Resolver`. An exact-name check sees the one and misses the
// 54, so three quarters of the app's route surface never gets parsed at all.
export const MetadataResolver = Resolver;

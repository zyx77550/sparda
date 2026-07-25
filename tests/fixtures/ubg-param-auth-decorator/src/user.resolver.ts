import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UserService } from './user.service';
import { AuthWorkspace, GetUser, Author, Whoami } from './decorators';

@Resolver()
export class UserResolver {
  constructor(private userService: UserService) {}

  // guarded by an @AuthWorkspace() PARAM decorator — name carries the "auth" token, so the
  // route runs behind auth. Must NOT flag UNGUARDED_MUTATION.
  @Mutation(() => Boolean)
  async createUser(@AuthWorkspace() workspace: any, @Args('input') input: any) {
    return this.userService.create({ ...input, workspaceId: workspace.id });
  }

  // guarded by a BARE-principal @GetUser() param decorator — "GetUser" carries NO
  // GUARD_NAME token, so it only becomes a guard via the assertedGuard marker. Must NOT
  // flag UNGUARDED_MUTATION.
  @Mutation(() => Boolean)
  async touchUser(@GetUser() user: any) {
    return this.userService.create({ id: user.id, touched: true });
  }

  // NO auth param at all — a genuine unguarded mutation. Must STILL flag
  // UNGUARDED_MUTATION (the asserted-guard modeling must never suppress a real hole).
  @Mutation(() => Boolean)
  async wipeAllUsers() {
    return this.userService.wipe();
  }

  // @Author is a DECOY — its name starts with "auth" but it injects a post author, not the
  // authenticated principal. It must NOT be read as a guard, so this mutation MUST flag.
  @Mutation(() => Boolean)
  async authorWrite(@Author() author: any) {
    return this.userService.create({ author });
  }

  // @Whoami has no auth token in its NAME but its BODY reads request.user — behaviour proves
  // it injects the principal, so this mutation must NOT flag (the name-match could never catch it).
  @Mutation(() => Boolean)
  async whoamiWrite(@Whoami() me: any) {
    return this.userService.create({ by: me });
  }
}

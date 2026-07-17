import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { AuthGuard } from './auth.guard';

@Resolver()
export class UserResolver {
  constructor(private userService: UserService) {}

  // a Query = a READ operation
  @Query(() => [String], { name: 'users' })
  async users() {
    return this.userService.findAll();
  }

  // a Mutation = a STATE CHANGE, guarded
  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async createUser(@Args('input') input: any) {
    return this.userService.create(input);
  }

  // a Mutation with NO guard — a genuine unguarded mutation
  @Mutation(() => Boolean)
  async deleteAllUsers() {
    return this.userService.create({ deleted: true });
  }
}

import { Mutation, Args } from '@nestjs/graphql';
import { AuthWorkspace } from './auth.decorator';
import { MetadataResolver } from './decorators';
import { BillingService } from './billing.service';

@MetadataResolver(() => Object)
export class WorkspaceResolver {
  constructor(private billing: BillingService, private prisma: any) {}

  // THE SAGA HOLE, and the reason the pre-filter matters. The subscription is cancelled
  // at Stripe — irreversible, outside any transaction — and the workspace is then soft
  // deleted. If the write fails, the customer has no subscription and a live workspace.
  @Mutation(() => Boolean)
  async deleteCurrentWorkspace(@AuthWorkspace() ws: any, @Args('id') id: string) {
    await this.billing.cancelSubscription(id);
    await this.prisma.workspace.update({ where: { id }, data: { deletedAt: new Date() } });
    return true;
  }
}

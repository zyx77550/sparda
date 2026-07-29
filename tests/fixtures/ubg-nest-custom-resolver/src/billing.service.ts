import { Injectable } from '@nestjs/common';

@Injectable()
export class BillingService {
  constructor(private stripe: any) {}

  async cancelSubscription(id: string) {
    return this.stripe.subscriptions.cancel(id);
  }
}

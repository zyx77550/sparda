import { Controller, Post, Body } from '@nestjs/common';
import { MessageOutboundService } from './senders';

@Controller('messaging')
export class MessagingController {
  constructor(private outbound: MessageOutboundService, private prisma: any) {}

  // ONE route, ONE missing compensation path, four irreversible leaves. The remediation
  // is per ROUTE (wrap the send and the write, or add an undo) — never per leaf — so per
  // leaf was never the honest unit of reporting.
  @Post('send')
  async send(@Body() body: any) {
    await this.outbound.sendMessage(body.to);
    return this.prisma.message.create({ data: body });
  }

  // a second route, so the collapse is per-route and not global
  @Post('charge')
  async charge(@Body() body: any) {
    await this.stripe.invoices.pay(body.invoiceId);
    return this.prisma.payment.create({ data: body });
  }

  // ONLY generic external calls — an unknown fetch, in the wild almost always a READ.
  // Innate immunity (ADR-072) keeps this an ADVISORY, and collapsing SEVERAL of them may
  // never manufacture a hard finding: the collapse changes the count, never the class.
  @Post('sync')
  async sync(@Body() body: any) {
    await fetch('https://example.test/a');
    await fetch('https://example.test/b');
    return this.prisma.sync.create({ data: body });
  }

  private stripe: any;
}

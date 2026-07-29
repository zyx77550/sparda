import { Controller, Post, Body } from '@nestjs/common';

@Controller()
export class WebhooksController {
  constructor(private prisma: any) {}

  // ONE decorator, TWO live routes. Nest serves both; reading only `args[0]` saw an
  // ArrayExpression, judged it "not a literal" and fell back to the controller prefix,
  // collapsing every array-pathed controller onto a phantom `POST /`. Taking only the
  // FIRST element would be worse — a live endpoint lost in silence (ADR-079).
  @Post(['webhooks/stripe', 'webhooks/stripe/legacy'])
  async stripe(@Body() body: any) {
    return this.prisma.event.create({ data: body });
  }

  // an element SPARDA cannot read: the readable sibling is still routed, the doubt is
  // still declared
  @Post(['webhooks/ok', LEGACY_PATH])
  async mixed(@Body() body: any) {
    return this.prisma.event.create({ data: body });
  }
}

declare const LEGACY_PATH: string;

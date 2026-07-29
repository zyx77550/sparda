import { Injectable } from '@nestjs/common';

// A provider-strategy fan-out — twenty's messaging shape. ONE logical "send an email"
// resolves, through DI, into four leaves. Each is its own effect node, so the SAME
// missing compensation path used to be reported four times on one route.
@Injectable()
export class GmailSender {
  constructor(private gmail: any) {}
  async sendMessage(to: string) {
    return this.gmail.messages.send({ to });
  }
}

@Injectable()
export class MicrosoftSender {
  constructor(private graph: any) {}
  async sendMessage(to: string) {
    return this.graph.sendMail({ to });
  }
}

@Injectable()
export class SmtpSender {
  constructor(private smtp: any) {}
  async sendMessage(to: string) {
    return this.smtp.sendMail({ to });
  }
}

@Injectable()
export class MessageOutboundService {
  constructor(
    private gmailSender: GmailSender,
    private microsoftSender: MicrosoftSender,
    private smtpSender: SmtpSender,
  ) {}

  async sendMessage(to: string) {
    await this.gmailSender.sendMessage(to);
    await this.microsoftSender.sendMessage(to);
    return this.smtpSender.sendMessage(to);
  }
}

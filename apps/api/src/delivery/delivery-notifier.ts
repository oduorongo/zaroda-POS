import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { BuiltEmail, JobInfo, buildJobOpenEmail, buildNewQuoteEmail, buildPickedUpEmail, buildRiderChosenEmail } from './delivery-email';

/** A shop asking "anyone" must not email the whole rider pool: a cap, the shop's own riders first. */
export const MAX_JOB_EMAILS = 25;

export interface RiderContact {
  email: string;
  fullName: string | null;
}

/**
 * Emails around a delivery. Always called AFTER the real work is saved, never awaited by the request,
 * and never able to fail it: a rider or shopper who doesn't get an email still sees everything on the
 * site. (Resend's free plan allows 100 emails a day, which is why the first quote - not every quote -
 * is announced, and why "open to everyone" is capped.)
 */
@Injectable()
export class DeliveryNotifier {
  private readonly logger = new Logger(DeliveryNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  private get base(): string {
    return (this.config.get<string>('STOREFRONT_BASE_URL') ?? 'https://shop.zarodashop.com').replace(/\/+$/, '');
  }

  private async send(to: string, built: BuiltEmail): Promise<void> {
    try {
      const result = await this.email.sendEmail({ to, ...built });
      if (!result.sent) this.logger.warn(`Delivery email to ${to} was not sent: ${result.detail ?? 'unknown reason'}`);
    } catch (e) {
      this.logger.error({ err: e }, 'Delivery email failed');
    }
  }

  /** The shopper's email address, or null when they signed in by phone (no email to write to). */
  private async buyerEmail(buyerId: string): Promise<string | null> {
    try {
      const buyer = await this.prisma.buyer.findUnique({ where: { id: buyerId }, select: { email: true } });
      return buyer?.email ?? null;
    } catch (e) {
      this.logger.error({ err: e }, 'Could not look up the shopper for a delivery email');
      return null;
    }
  }

  /** Riders who may quote on a job that has just been opened. */
  async jobOpen(riders: RiderContact[], job: JobInfo): Promise<void> {
    const url = `${this.base}/rider`;
    for (const rider of riders.slice(0, MAX_JOB_EMAILS)) {
      await this.send(rider.email, buildJobOpenEmail(rider.fullName, job, url));
    }
  }

  /** The first live price on a job. */
  async newQuote(buyerId: string, info: { orderId: string; orderNumber: string; shopName: string; fee: number; deadline: Date }): Promise<void> {
    const to = await this.buyerEmail(buyerId);
    if (!to) return;
    await this.send(to, buildNewQuoteEmail(info.orderNumber, info.shopName, info.fee, info.deadline, `${this.base}/orders/${info.orderId}`));
  }

  /** The rider the customer chose. */
  async riderChosen(rider: RiderContact, info: { shopName: string; pickupArea: string; dropoffSummary: string; fee: number }): Promise<void> {
    await this.send(rider.email, buildRiderChosenEmail(rider.fullName, info.shopName, info.pickupArea, info.dropoffSummary, info.fee, `${this.base}/rider`));
  }

  /** The goods are with the rider. */
  async pickedUp(buyerId: string, info: { orderId: string; orderNumber: string; shopName: string; agreedFee: number | null }): Promise<void> {
    const to = await this.buyerEmail(buyerId);
    if (!to) return;
    await this.send(to, buildPickedUpEmail(info.orderNumber, info.shopName, info.agreedFee, `${this.base}/orders/${info.orderId}`));
  }
}

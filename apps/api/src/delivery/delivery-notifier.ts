import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { BuiltEmail, JobInfo, buildJobOpenEmail, buildNewQuoteEmail, buildPickedUpEmail, buildRiderChosenEmail } from './delivery-email';
import { smsJobOpen, smsNewQuote, smsPickedUp, smsRiderChosen } from './delivery-sms';

/** A shop asking "anyone" must not email the whole rider pool: a cap, the shop's own riders first. */
export const MAX_JOB_EMAILS = 25;

export interface RiderContact {
  email: string | null;
  /** Normalized 2547XXXXXXXX. Optional so callers that only know an email keep working. */
  phone?: string | null;
  fullName: string | null;
}

/** How to reach someone: a text if they have a phone, an email if they have an address. Either may be missing. */
export interface Reach {
  email?: string | null;
  phone?: string | null;
}

/**
 * Texts and emails around a delivery. A text goes first when there is a phone number, because most riders
 * never check email; if the text cannot be delivered (Safaricom numbers are blocked until Zaroda has a sender ID)
 * the email goes instead, and if there is no email the person simply sees it on the site. Always called AFTER the real work is saved, never awaited by the request,
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
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private get base(): string {
    return (this.config.get<string>('STOREFRONT_BASE_URL') ?? 'https://shop.zarodashop.com').replace(/\/+$/, '');
  }

  private async send(to: Reach, text: string, built: BuiltEmail): Promise<void> {
    if (to.phone) {
      try {
        const result = await this.sms.sendSms({ to: `+${to.phone}`, message: text });
        if (result.sent) return;
      } catch (e) {
        this.logger.error({ err: e }, 'Delivery text failed');
      }
    }
    if (!to.email) return;
    try {
      const result = await this.email.sendEmail({ to: to.email, ...built });
      if (!result.sent) this.logger.warn(`Delivery email to ${to.email} was not sent: ${result.detail ?? 'unknown reason'}`);
    } catch (e) {
      this.logger.error({ err: e }, 'Delivery email failed');
    }
  }

  /** How to reach the shopper: their phone and/or email (a phone sign-in has no email, an email sign-in may have no phone). */
  private async buyerReach(buyerId: string): Promise<Reach | null> {
    try {
      const buyer = await this.prisma.buyer.findUnique({ where: { id: buyerId }, select: { email: true, phone: true } });
      return buyer && (buyer.email || buyer.phone) ? buyer : null;
    } catch (e) {
      this.logger.error({ err: e }, 'Could not look up the shopper for a delivery message');
      return null;
    }
  }

  /** Riders who may quote on a job that has just been opened. */
  async jobOpen(riders: RiderContact[], job: JobInfo): Promise<void> {
    const url = `${this.base}/rider`;
    for (const rider of riders.slice(0, MAX_JOB_EMAILS)) {
      await this.send(rider, smsJobOpen(job, url), buildJobOpenEmail(rider.fullName, job, url));
    }
  }

  /** The first live price on a job. */
  async newQuote(buyerId: string, info: { orderId: string; orderNumber: string; shopName: string; fee: number; deadline: Date }): Promise<void> {
    const to = await this.buyerReach(buyerId);
    if (!to) return;
    const url = `${this.base}/orders/${info.orderId}`;
    await this.send(to, smsNewQuote(info.orderNumber, info.fee, url), buildNewQuoteEmail(info.orderNumber, info.shopName, info.fee, info.deadline, url));
  }

  /** The rider the customer chose. */
  async riderChosen(rider: RiderContact, info: { shopName: string; pickupArea: string; dropoffSummary: string; fee: number }): Promise<void> {
    const url = `${this.base}/rider`;
    await this.send(rider, smsRiderChosen(info.shopName, info.pickupArea, info.dropoffSummary, info.fee, url), buildRiderChosenEmail(rider.fullName, info.shopName, info.pickupArea, info.dropoffSummary, info.fee, url));
  }

  /** The goods are with the rider. */
  async pickedUp(buyerId: string, info: { orderId: string; orderNumber: string; shopName: string; agreedFee: number | null }): Promise<void> {
    const to = await this.buyerReach(buyerId);
    if (!to) return;
    const url = `${this.base}/orders/${info.orderId}`;
    await this.send(to, smsPickedUp(info.orderNumber, info.agreedFee, url), buildPickedUpEmail(info.orderNumber, info.shopName, info.agreedFee, url));
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { HotelNotificationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { guestPhone } from './guest-format';
import { loadRules } from './hotel-settings.service';
import { hotelMessage, MessageKind } from './hotel-messages.util';

type Outcome = 'SENT' | 'SKIPPED' | 'FAILED' | 'ALREADY_DONE';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TX = { timeout: 15_000, maxWait: 15_000 };

/**
 * Texts the hotel's guests: confirmation of a front-desk booking, a reminder the day before arrival, a thank-you after check-out and
 * a cancellation notice. Each (booking, kind) is sent once - the claim row in hotel_notifications is made first - and never to a
 * guest who has opted out, to a business that switched that text off, or to a number that is not a phone. SMS first (Safaricom
 * still blocks some senders), then email when the guest gave one. Best-effort: it never throws into the action that triggered it.
 */
@Injectable()
export class HotelNotifierService {
  private readonly logger = new Logger(HotelNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly email: ResendEmailProvider,
  ) {}

  private asTenant<T>(
    organizationId: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx as unknown as TenantTx);
    }, TX);
  }

  async send(
    organizationId: string,
    bookingId: string,
    kind: MessageKind,
    extra: { refundDue?: number; feeKept?: number } = {},
  ): Promise<Outcome> {
    try {
      return await this.sendInner(organizationId, bookingId, kind, extra);
    } catch (e) {
      this.logger.warn({ err: e, bookingId, kind }, 'Guest message failed');
      return 'FAILED';
    }
  }

  private async sendInner(
    organizationId: string,
    bookingId: string,
    kind: MessageKind,
    extra: { refundDue?: number; feeKept?: number },
  ): Promise<Outcome> {
    // 1. Decide, and claim the (booking, kind) slot in the same step so two runs cannot both send.
    const plan = await this.asTenant(organizationId, async (tx) => {
      const b = await tx.roomBooking.findUnique({
        where: { id: bookingId },
        include: {
          guest: { select: { smsOptOut: true } },
          folio: { include: { entries: true } },
        },
      });
      if (!b) return null;
      const rules = await loadRules(tx);
      const switchedOn =
        kind === 'REMINDER'
          ? rules.reminderSms
          : kind === 'THANK_YOU'
            ? rules.thankYouSms
            : rules.confirmationSms;
      const phone = guestPhone(b.guestPhone);
      const skip = !switchedOn
        ? 'Switched off by the hotel'
        : b.smsOptOut || b.guest?.smsOptOut
          ? 'Guest opted out'
          : !phone && !b.guestEmail
            ? 'No phone or email'
            : null;
      try {
        await tx.hotelNotification.create({
          data: {
            organizationId,
            bookingId,
            kind: kind as HotelNotificationKind,
            status: skip ? 'SKIPPED' : 'PENDING',
            detail: skip,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          return 'DONE' as const;
        throw e;
      }
      if (skip) return 'SKIPPED' as const;
      const paid = b.folio
        ? b.folio.entries.reduce(
            (s, e) =>
              s +
              (e.type === 'PAYMENT'
                ? Number(e.amount)
                : e.type === 'REFUND'
                  ? -Number(e.amount)
                  : 0),
            0,
          )
        : b.paidAt
          ? b.depositAmount
          : 0;
      return {
        phone,
        email: b.guestEmail,
        hotelName: b.hotelName,
        text: hotelMessage(kind, {
          guestName: b.guestName,
          hotelName: b.hotelName,
          bookingNumber: b.bookingNumber,
          roomTypeName: b.roomTypeName,
          rooms: b.rooms,
          checkIn: iso(b.checkIn),
          checkOut: iso(b.checkOut),
          total: Number(b.total),
          paid: Math.round(paid * 100) / 100,
          ...extra,
        }),
      };
    });
    if (plan === null) return 'FAILED';
    if (plan === 'DONE') return 'ALREADY_DONE';
    if (plan === 'SKIPPED') return 'SKIPPED';

    // 2. Send outside any transaction.
    let how: string | null = null;
    if (plan.phone) {
      const to = plan.phone.startsWith('+') ? plan.phone : `+${plan.phone}`;
      const r = await this.sms
        .sendSms({ to, message: plan.text })
        .catch(() => ({ sent: false }));
      if (r.sent) how = 'sms';
    }
    if (!how && plan.email) {
      const r = await this.email
        .sendEmail({
          to: plan.email,
          subject: `${plan.hotelName}`,
          html: `<p>${plan.text.replace(/[<>&]/g, '')}</p>`,
          text: plan.text,
        })
        .catch(() => ({ sent: false }));
      if (r.sent) how = 'email';
    }

    // 3. Record what happened.
    await this.asTenant(organizationId, (tx) =>
      tx.hotelNotification.updateMany({
        where: { bookingId, kind: kind as HotelNotificationKind },
        data: {
          status: how ? 'SENT' : 'FAILED',
          detail: how ?? 'Could not be delivered',
        },
      }),
    );
    return how ? 'SENT' : 'FAILED';
  }
}

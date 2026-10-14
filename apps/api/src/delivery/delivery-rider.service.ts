import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryJob, DeliveryJobContact, DeliveryJobStatus, DeliveryQuote, DeliveryQuoteStatus, OnlineOrderStatus, RiderStatus } from '@prisma/client';
import { parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { roundMoney } from '../online-orders/online-orders.util';
import { DeliverDto, QuoteDto } from './dto/delivery.dto';
import { deliveryCodeFor, MAX_CODE_ATTEMPTS } from './delivery.util';
import { DeliveryNotifier } from './delivery-notifier';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
// How far back a rider's finished jobs are listed.
const FINISHED_JOB_DAYS = 14;

type JobWithQuotes = DeliveryJob & { quotes: DeliveryQuote[] };
type JobWithContact = JobWithQuotes & { contact: DeliveryJobContact | null };

const quoteView = (q: DeliveryQuote) => ({ id: q.id, fee: q.fee, etaMinutes: q.etaMinutes, note: q.note, status: q.status });

/** A job a rider may bid on: only what is safe to show before being chosen - no buyer name, phone or address. */
export function toOpenJobView(job: JobWithQuotes) {
  const mine = job.quotes[0];
  return {
    id: job.id,
    orderNumber: job.orderNumber,
    shopName: job.shopName,
    pickupArea: job.pickupArea,
    dropoffSummary: job.dropoffSummary,
    itemCount: job.itemCount,
    quoteDeadline: job.quoteDeadline,
    myQuote: mine ? quoteView(mine) : null,
  };
}

/** A job the rider was chosen for: now they get the buyer's name, phone and full address. */
export function toMyJobView(job: JobWithContact) {
  return {
    ...toOpenJobView(job),
    status: job.status,
    agreedFee: job.agreedFee,
    assignedAt: job.assignedAt,
    pickedUpAt: job.pickedUpAt,
    deliveredAt: job.deliveredAt,
    cashCollected: job.cashCollected,
    codeLocked: job.codeAttempts >= MAX_CODE_ATTEMPTS,
    buyerName: job.contact?.buyerName ?? null,
    buyerPhone: job.contact?.buyerPhone ?? null,
    deliveryAddress: job.contact?.deliveryAddress ?? null,
  };
}

/**
 * Delivery jobs from the rider's side. Every method runs with the rider's id set as the
 * database's "current rider" (see rls.sql), so a rider can only ever read the jobs they may
 * bid on or were chosen for, and only their own quotes. The checks here are the second layer.
 */
@Injectable()
export class DeliveryRiderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifier: DeliveryNotifier,
  ) {}

  private runAsRider<T>(riderId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_rider', ${riderId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  private async requireApproved(tx: TenantTx, riderId: string) {
    const rider = await tx.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new ForbiddenException('Rider account not found');
    if (rider.status !== RiderStatus.APPROVED) {
      throw new ForbiddenException(
        rider.status === RiderStatus.SUSPENDED ? 'Your rider account is suspended' : 'Your rider account has not been approved yet - you can take jobs once it is',
      );
    }
    return rider;
  }

  /** Open jobs this rider may bid on (the database decides which), newest first. */
  async listOpen(riderId: string) {
    const jobs = await this.runAsRider(riderId, async (tx) => {
      await this.requireApproved(tx, riderId);
      return tx.deliveryJob.findMany({
        where: { status: DeliveryJobStatus.OPEN, quoteDeadline: { gt: new Date() } },
        include: { quotes: { where: { riderId } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
    return jobs.map(toOpenJobView);
  }

  /** Jobs this rider won (assigned, in progress) plus recently finished ones. */
  async listMine(riderId: string) {
    const since = new Date(Date.now() - FINISHED_JOB_DAYS * 86_400_000);
    const jobs = await this.runAsRider(riderId, async (tx) => {
      await this.requireApproved(tx, riderId);
      return tx.deliveryJob.findMany({
        where: {
          riderId,
          OR: [{ status: { in: [DeliveryJobStatus.ASSIGNED, DeliveryJobStatus.PICKED_UP] } }, { status: DeliveryJobStatus.DELIVERED, deliveredAt: { gte: since } }],
        },
        include: { quotes: { where: { riderId } }, contact: true },
        orderBy: { assignedAt: 'desc' },
        take: 50,
      });
    });
    return jobs.map(toMyJobView);
  }

  async quote(riderId: string, jobId: string, dto: QuoteDto) {
    const result = await this.runAsRider(riderId, async (tx) => {
      await this.requireApproved(tx, riderId);
      // Not visible to this rider (not eligible, not open, or expired) all look the same: not found.
      const job = await tx.deliveryJob.findFirst({ where: { id: jobId, status: DeliveryJobStatus.OPEN, quoteDeadline: { gt: new Date() } } });
      if (!job) throw new NotFoundException('This job is no longer open for quotes');

      const existing = await tx.deliveryQuote.findUnique({ where: { jobId_riderId: { jobId, riderId } } });
      if (existing && (existing.status === DeliveryQuoteStatus.ACCEPTED || existing.status === DeliveryQuoteStatus.REJECTED)) {
        throw new BadRequestException('Your quote on this job is already settled');
      }
      const data = { fee: dto.fee, etaMinutes: dto.etaMinutes ?? null, note: dto.note?.trim() || null, status: DeliveryQuoteStatus.OFFERED };
      const quote = existing
        ? await tx.deliveryQuote.update({ where: { id: existing.id }, data })
        : await tx.deliveryQuote.create({ data: { ...data, jobId, riderId, organizationId: job.organizationId } });

      // Is this the FIRST live price on the job? Only then is the shopper emailed (a price change, or a
      // second rider's offer, would just be noise). A rider can neither count other riders' quotes nor
      // read the order, and both are needed here, so from this point the transaction acts for the job's
      // business - the rider and the job were already verified above.
      let announceTo: string | null = null;
      if (!existing || existing.status === DeliveryQuoteStatus.WITHDRAWN) {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${job.organizationId}, true)`;
        const live = await tx.deliveryQuote.count({ where: { jobId, status: DeliveryQuoteStatus.OFFERED } });
        if (live === 1) {
          const order = await tx.onlineOrder.findUnique({ where: { id: job.orderId }, select: { buyerId: true } });
          announceTo = order?.buyerId ?? null;
        }
      }
      return { job, quote, announceTo };
    });
    if (result.announceTo) {
      void this.notifier.newQuote(result.announceTo, {
        orderId: result.job.orderId,
        orderNumber: result.job.orderNumber,
        shopName: result.job.shopName,
        fee: result.quote.fee,
        deadline: result.job.quoteDeadline,
      });
    }
    return { ...toOpenJobView({ ...result.job, quotes: [result.quote] }) };
  }

  async withdrawQuote(riderId: string, jobId: string) {
    await this.runAsRider(riderId, async (tx) => {
      const done = await tx.deliveryQuote.updateMany({ where: { jobId, riderId, status: DeliveryQuoteStatus.OFFERED }, data: { status: DeliveryQuoteStatus.WITHDRAWN } });
      if (done.count !== 1) throw new NotFoundException('You have no open quote on this job');
    });
    return { withdrawn: true };
  }

  async pickUp(riderId: string, jobId: string) {
    const { job, buyerId } = await this.runAsRider(riderId, async (tx) => {
      await this.requireApproved(tx, riderId);
      const done = await tx.deliveryJob.updateMany({
        where: { id: jobId, riderId, status: DeliveryJobStatus.ASSIGNED },
        data: { status: DeliveryJobStatus.PICKED_UP, pickedUpAt: new Date() },
      });
      if (done.count !== 1) throw new BadRequestException('This job is not waiting to be picked up');
      const full = await tx.deliveryJob.findUniqueOrThrow({ where: { id: jobId }, include: { quotes: { where: { riderId } }, contact: true } });
      // Who to tell: the order belongs to the business, which a rider cannot read, so look it up as the
      // job's business (the rider and the job were verified above).
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${full.organizationId}, true)`;
      const order = await tx.onlineOrder.findUnique({ where: { id: full.orderId }, select: { buyerId: true } });
      return { job: full, buyerId: order?.buyerId ?? null };
    });
    if (buyerId) {
      void this.notifier.pickedUp(buyerId, { orderId: job.orderId, orderNumber: job.orderNumber, shopName: job.shopName, agreedFee: job.agreedFee });
    }
    return toMyJobView(job);
  }

  /**
   * The rider enters the 4-digit code the buyer gives them at the door. Right: the job is
   * delivered and the order completes (which is when Zaroda's commission becomes owed). Wrong:
   * the try is counted - and that count is saved even though the request then fails - and after
   * too many the rider is locked out and the shop settles the delivery.
   */
  async deliver(riderId: string, jobId: string, dto: DeliverDto) {
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    const outcome = await this.runAsRider(riderId, async (tx) => {
      await this.requireApproved(tx, riderId);
      const job = await tx.deliveryJob.findFirst({ where: { id: jobId, riderId } });
      if (!job) throw new NotFoundException('Job not found');
      if (job.status !== DeliveryJobStatus.PICKED_UP) {
        throw new BadRequestException(job.status === DeliveryJobStatus.ASSIGNED ? 'Mark the goods as picked up first' : 'This job is not out for delivery');
      }
      // Count this try FIRST, and only while tries remain - one statement, so the limit and the count can't
      // be separated. Reading the count and comparing afterwards would let any number of guesses sent at the
      // same instant all see "0 tries used" and all go ahead, which turns a 4-digit code into a few thousand
      // parallel guesses. The database serialises these updates, so at most MAX_CODE_ATTEMPTS ever get through.
      const claimed = await tx.$queryRaw<{ codeAttempts: number }[]>`
        UPDATE delivery_jobs SET "codeAttempts" = "codeAttempts" + 1
         WHERE id = ${job.id} AND "codeAttempts" < ${MAX_CODE_ATTEMPTS}
        RETURNING "codeAttempts"`;
      if (claimed.length === 0) return { kind: 'locked' as const };

      if (deliveryCodeFor(job.id, key) !== dto.code.trim()) {
        return { kind: 'wrong' as const, remaining: Math.max(0, MAX_CODE_ATTEMPTS - Number(claimed[0].codeAttempts)) };
      }

      const now = new Date();
      const done = await tx.deliveryJob.updateMany({
        where: { id: job.id, status: DeliveryJobStatus.PICKED_UP },
        data: { status: DeliveryJobStatus.DELIVERED, deliveredAt: now, cashCollected: dto.cashCollected ?? job.agreedFee },
      });
      if (done.count !== 1) throw new ConflictException('This job was just updated - refresh');

      // The delivery being confirmed is what completes the order (and so makes commission owed). The
      // order belongs to the business, which the rider can't read - so this one step switches to
      // the job's business, after the code and the rider have been verified above.
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${job.organizationId}, true)`;
      const order = await tx.onlineOrder.findUnique({ where: { id: job.orderId } });
      if (order && (order.status === OnlineOrderStatus.ACCEPTED || order.status === OnlineOrderStatus.READY)) {
        await tx.onlineOrder.updateMany({
          where: { id: order.id, status: order.status },
          data: { status: OnlineOrderStatus.COMPLETED, completedAt: now, commissionAmount: roundMoney(Number(order.subtotal) * Number(order.commissionRate)) },
        });
      }
      const full = await tx.deliveryJob.findUniqueOrThrow({ where: { id: job.id }, include: { quotes: { where: { riderId } }, contact: true } });
      return { kind: 'delivered' as const, job: full };
    });

    if (outcome.kind === 'locked') {
      throw new ForbiddenException('Too many wrong codes - ask the shop to settle this delivery');
    }
    if (outcome.kind === 'wrong') {
      throw new BadRequestException(
        outcome.remaining > 0
          ? `That code is wrong. ${outcome.remaining} ${outcome.remaining === 1 ? 'try' : 'tries'} left.`
          : 'That code is wrong, and you are out of tries - ask the shop to settle this delivery',
      );
    }
    return toMyJobView(outcome.job);
  }
}

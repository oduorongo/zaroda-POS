import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeliveryAudience,
  DeliveryJob,
  DeliveryJobStatus,
  DeliveryQuote,
  DeliveryQuoteStatus,
  FulfilmentType,
  OnlineOrderStatus,
  Rider,
  RiderStatus,
} from '@prisma/client';
import { parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CancelDeliveryDto, RequestDeliveryDto } from './dto/delivery.dto';
import { deliveryCodeFor, effectiveJobStatus, isActiveJobStatus, MAX_CODE_ATTEMPTS, QUOTE_WINDOW_MS, summarizeDropoff } from './delivery.util';
import { DeliveryNotifier, MAX_JOB_EMAILS, RiderContact } from './delivery-notifier';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };

type JobWithPeople = DeliveryJob & { quotes: (DeliveryQuote & { rider: Rider })[]; rider: Rider | null };
const JOB_INCLUDE = { quotes: { include: { rider: true }, orderBy: { fee: 'asc' as const } }, rider: true };

// The rider's id is called riderId so it can never overwrite the id of the quote it sits beside.
const riderCard = (r: Rider) => ({ riderId: r.id, name: r.fullName, vehicleType: r.vehicleType, plateNumber: r.plateNumber });
const assignedCard = (r: Rider) => ({ ...riderCard(r), phone: r.phone });

/** What the business sees of a delivery: every quote, the chosen rider with their phone, and the cash they reported. */
export function toBusinessJobView(job: JobWithPeople) {
  return {
    id: job.id,
    orderId: job.orderId,
    status: effectiveJobStatus(job),
    audience: job.audience,
    targetRiderId: job.targetRiderId,
    quoteDeadline: job.quoteDeadline,
    createdAt: job.createdAt,
    agreedFee: job.agreedFee,
    assignedAt: job.assignedAt,
    pickedUpAt: job.pickedUpAt,
    deliveredAt: job.deliveredAt,
    cashCollected: job.cashCollected,
    cancelReason: job.cancelReason,
    codeLocked: job.codeAttempts >= MAX_CODE_ATTEMPTS,
    rider: job.rider && job.status !== DeliveryJobStatus.OPEN ? assignedCard(job.rider) : null,
    quotes: job.quotes.map((q) => ({
      id: q.id,
      ...riderCard(q.rider),
      fee: q.fee,
      etaMinutes: q.etaMinutes,
      note: q.note,
      status: q.status,
    })),
  };
}

/**
 * What the buyer sees: the live quotes to choose from, and once one is accepted the rider's
 * contact details, the agreed price (paid in cash at the door) and the 4-digit code to give
 * the rider when the goods arrive. The code is never shown to the business or the rider.
 */
export function toBuyerJobView(job: JobWithPeople, code: string) {
  const assigned = job.status === DeliveryJobStatus.ASSIGNED || job.status === DeliveryJobStatus.PICKED_UP || job.status === DeliveryJobStatus.DELIVERED;
  return {
    id: job.id,
    status: effectiveJobStatus(job),
    quoteDeadline: job.quoteDeadline,
    agreedFee: job.agreedFee,
    pickedUpAt: job.pickedUpAt,
    deliveredAt: job.deliveredAt,
    quotes: job.quotes
      .filter((q) => (assigned ? q.status === DeliveryQuoteStatus.ACCEPTED : q.status === DeliveryQuoteStatus.OFFERED))
      .map((q) => ({ id: q.id, ...riderCard(q.rider), fee: q.fee, etaMinutes: q.etaMinutes, note: q.note })),
    rider: assigned && job.rider ? assignedCard(job.rider) : null,
    deliveryCode: assigned && job.status !== DeliveryJobStatus.DELIVERED ? code : null,
  };
}

/**
 * Delivery jobs from the business's and the buyer's side: asking for a rider, watching quotes,
 * the buyer choosing one. (The rider's side is DeliveryRiderService.) A job is created only for
 * an accepted DELIVERY order, and only one job can be in play per order.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly config: ConfigService,
    private readonly notifier: DeliveryNotifier,
  ) {}

  /**
   * Who to tell about a newly opened job: the one rider picked, or the business's own riders, or - when
   * open to everyone - its own riders first and then the pool, up to a cap so a big pool is not flooded.
   */
  private async jobRecipients(tx: TenantTx, organizationId: string, audience: DeliveryAudience, targetRiderId?: string): Promise<RiderContact[]> {
    const select = { email: true, fullName: true };
    if (audience === DeliveryAudience.ONE_RIDER) {
      return targetRiderId ? tx.rider.findMany({ where: { id: targetRiderId, status: RiderStatus.APPROVED }, select }) : [];
    }
    const own = await tx.rider.findMany({ where: { organizationId, status: RiderStatus.APPROVED }, select, take: MAX_JOB_EMAILS });
    if (audience === DeliveryAudience.SHOP_RIDERS || own.length >= MAX_JOB_EMAILS) return own;
    const pool = await tx.rider.findMany({
      where: { organizationId: null, status: RiderStatus.APPROVED },
      select,
      orderBy: { lastLoginAt: { sort: 'desc', nulls: 'last' } },
      take: MAX_JOB_EMAILS - own.length,
    });
    return [...own, ...pool];
  }

  private codeFor(jobId: string) {
    return deliveryCodeFor(jobId, parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY')));
  }

  private runAsBuyer<T>(buyerId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_buyer', ${buyerId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Marks jobs whose quote window has passed as EXPIRED, so they stop blocking a fresh request. */
  private async expireStale(tx: TenantTx, orderId: string) {
    await tx.deliveryJob.updateMany({
      where: { orderId, status: DeliveryJobStatus.OPEN, quoteDeadline: { lte: new Date() } },
      data: { status: DeliveryJobStatus.EXPIRED },
    });
    await tx.deliveryQuote.updateMany({
      where: { job: { orderId, status: DeliveryJobStatus.EXPIRED }, status: DeliveryQuoteStatus.OFFERED },
      data: { status: DeliveryQuoteStatus.REJECTED },
    });
  }

  // ── The business ──────────────────────────────────────────────────────

  async requestRider(orderId: string, dto: RequestDeliveryDto) {
    const { organizationId } = getTenantStore();
    const { job, recipients } = await this.tenantPrisma.run(async (tx) => {
      const order = await tx.onlineOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.fulfilmentType !== FulfilmentType.DELIVERY) throw new BadRequestException('This order is for pickup - it needs no rider');
      if (order.status !== OnlineOrderStatus.ACCEPTED && order.status !== OnlineOrderStatus.READY) {
        throw new BadRequestException(
          order.status === OnlineOrderStatus.PAID ? 'Accept the order first, then ask for a rider' : `This order is ${order.status.toLowerCase().replace('_', ' ')} - it can't be delivered`,
        );
      }
      // Two staff clicking at once must not create two jobs: serialize on the order row.
      await tx.$queryRaw`SELECT id FROM online_orders WHERE id = ${orderId} FOR UPDATE`;
      await this.expireStale(tx, orderId);
      const active = await tx.deliveryJob.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
      if (active && isActiveJobStatus(active.status)) {
        throw new ConflictException('A rider has already been asked for this order - cancel that request first if you want to change it');
      }

      let targetRiderId: string | undefined;
      if (dto.audience === DeliveryAudience.SHOP_RIDERS) {
        const own = await tx.rider.count({ where: { organizationId, status: RiderStatus.APPROVED } });
        if (own === 0) throw new BadRequestException('You have no active riders of your own yet - add one under "My riders", or ask everyone');
      } else if (dto.audience === DeliveryAudience.ONE_RIDER) {
        const rider = await tx.rider.findFirst({
          where: { id: dto.riderId, status: RiderStatus.APPROVED, OR: [{ organizationId }, { organizationId: null }] },
        });
        if (!rider) throw new BadRequestException('Pick one of your own riders, or an approved rider from the Zaroda pool');
        targetRiderId = rider.id;
      }

      const branch = await tx.branch.findUnique({ where: { id: order.branchId }, select: { name: true, county: true } });
      const created = await tx.deliveryJob.create({
        data: {
          organizationId,
          orderId,
          audience: dto.audience,
          targetRiderId,
          orderNumber: order.orderNumber,
          shopName: order.shopName,
          pickupArea: [branch?.name, branch?.county].filter(Boolean).join(', ') || order.shopName,
          dropoffSummary: summarizeDropoff(order.deliveryAddress),
          itemCount: Math.max(1, Math.round(order.lines.reduce((sum, l) => sum + Number(l.quantity), 0))),
          quoteDeadline: new Date(Date.now() + QUOTE_WINDOW_MS),
          contact: { create: { organizationId, buyerName: order.buyerName, buyerPhone: order.buyerPhone, deliveryAddress: order.deliveryAddress ?? '' } },
        },
      });
      return {
        job: await tx.deliveryJob.findUniqueOrThrow({ where: { id: created.id }, include: JOB_INCLUDE }),
        recipients: await this.jobRecipients(tx, organizationId, dto.audience, targetRiderId),
      };
    });
    // Tell the riders who may quote - after everything is saved, and never holding up or failing the request.
    void this.notifier.jobOpen(recipients, job);
    return toBusinessJobView(job);
  }

  /** The latest delivery request for an order, or null if none was ever made. */
  async getForOrder(orderId: string) {
    const job = await this.tenantPrisma.run(async (tx) => {
      await this.expireStale(tx, orderId);
      return tx.deliveryJob.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, include: JOB_INCLUDE });
    });
    return job ? toBusinessJobView(job) : null;
  }

  async cancelRequest(orderId: string, dto: CancelDeliveryDto) {
    const job = await this.tenantPrisma.run(async (tx) => {
      await this.expireStale(tx, orderId);
      const current = await tx.deliveryJob.findFirst({ where: { orderId, status: { in: [DeliveryJobStatus.OPEN, DeliveryJobStatus.ASSIGNED, DeliveryJobStatus.PICKED_UP] } } });
      if (!current) throw new NotFoundException('There is no active delivery request for this order');
      if (current.status === DeliveryJobStatus.PICKED_UP) {
        throw new BadRequestException('The rider already has the goods - settle it with them, then mark the order complete');
      }
      const done = await tx.deliveryJob.updateMany({
        where: { id: current.id, status: { in: [DeliveryJobStatus.OPEN, DeliveryJobStatus.ASSIGNED] } },
        data: { status: DeliveryJobStatus.CANCELLED, cancelledAt: new Date(), cancelReason: dto.reason?.trim() || null },
      });
      if (done.count !== 1) throw new ConflictException('The delivery just changed - refresh and try again');
      await tx.deliveryQuote.updateMany({ where: { jobId: current.id, status: DeliveryQuoteStatus.OFFERED }, data: { status: DeliveryQuoteStatus.REJECTED } });
      return tx.deliveryJob.findUniqueOrThrow({ where: { id: current.id }, include: JOB_INCLUDE });
    });
    return toBusinessJobView(job);
  }

  // ── The buyer ─────────────────────────────────────────────────────────

  private async buyerOrder(tx: TenantTx, buyerId: string, orderId: string) {
    const order = await tx.onlineOrder.findFirst({ where: { id: orderId, buyerId }, select: { id: true, fulfilmentType: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getForBuyer(buyerId: string, orderId: string) {
    const job = await this.runAsBuyer(buyerId, async (tx) => {
      await this.buyerOrder(tx, buyerId, orderId);
      await this.expireStale(tx, orderId);
      return tx.deliveryJob.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, include: JOB_INCLUDE });
    });
    return job ? toBuyerJobView(job, this.codeFor(job.id)) : null;
  }

  /** The buyer picks one quote: that rider gets the job, the price is fixed, the other quotes are closed. */
  async acceptQuote(buyerId: string, orderId: string, quoteId: string) {
    const job = await this.runAsBuyer(buyerId, async (tx) => {
      await this.buyerOrder(tx, buyerId, orderId);
      await this.expireStale(tx, orderId);
      const open = await tx.deliveryJob.findFirst({ where: { orderId, status: DeliveryJobStatus.OPEN }, orderBy: { createdAt: 'desc' } });
      if (!open) throw new BadRequestException('This delivery request is no longer open for quotes');
      const quote = await tx.deliveryQuote.findFirst({ where: { id: quoteId, jobId: open.id, status: DeliveryQuoteStatus.OFFERED } });
      if (!quote) throw new NotFoundException('That quote is no longer available - refresh to see the current ones');

      // Conditional on OPEN so it can only succeed once, even if the buyer double-taps.
      const assigned = await tx.deliveryJob.updateMany({
        where: { id: open.id, status: DeliveryJobStatus.OPEN },
        data: { status: DeliveryJobStatus.ASSIGNED, riderId: quote.riderId, agreedFee: quote.fee, assignedAt: new Date() },
      });
      if (assigned.count !== 1) throw new ConflictException('This delivery was just updated - refresh and try again');
      await tx.deliveryQuote.update({ where: { id: quote.id }, data: { status: DeliveryQuoteStatus.ACCEPTED } });
      await tx.deliveryQuote.updateMany({ where: { jobId: open.id, id: { not: quote.id }, status: DeliveryQuoteStatus.OFFERED }, data: { status: DeliveryQuoteStatus.REJECTED } });
      return tx.deliveryJob.findUniqueOrThrow({ where: { id: open.id }, include: JOB_INCLUDE });
    });
    // The chosen rider hears about it straight away, by email, as well as on their rider page.
    if (job.rider && job.agreedFee !== null) {
      void this.notifier.riderChosen(
        { email: job.rider.email, fullName: job.rider.fullName },
        { shopName: job.shopName, pickupArea: job.pickupArea, dropoffSummary: job.dropoffSummary, fee: job.agreedFee },
      );
    }
    return toBuyerJobView(job, this.codeFor(job.id));
  }
}

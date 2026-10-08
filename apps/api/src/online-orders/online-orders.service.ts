import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfilmentType,
  InventoryTxnType,
  OnlineOrder,
  OnlineOrderLine,
  OnlineOrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { decryptSecret, parseEncryptionKey } from '../common/crypto/secret-box';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { DEFAULT_COMMISSION_RATE } from '../online-store/online-store.constants';
import { TumaClient } from '../online-store/tuma.client';
import { ShopCatalogService } from './shop-catalog.service';
import {
  CancelOnlineOrderDto,
  CreateOnlineOrderDto,
  TumaCallbackDto,
} from './dto/online-order.dto';
import { generateOrderNumber, normalizeKenyanPhone, roundMoney } from './online-orders.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
// How long an unpaid order holds stock. An M-Pesa prompt itself times out
// in about a minute; this leaves room for a retry or two.
const PAYMENT_WINDOW_MS = 15 * 60_000;
// A retry before this would risk two live prompts for one order.
const RETRY_COOLDOWN_MS = 60_000;

type OrderWithLines = OnlineOrder & { lines: OnlineOrderLine[] };

/** What both the buyer and the business see. Never includes anything payment-secret. */
export function toOrderView(order: OrderWithLines) {
  const expired = order.status === OnlineOrderStatus.PENDING_PAYMENT && order.paymentDeadline <= new Date();
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: expired ? OnlineOrderStatus.EXPIRED : order.status,
    shop: { name: order.shopName, slug: order.shopSlug },
    fulfilmentType: order.fulfilmentType,
    deliveryAddress: order.deliveryAddress,
    buyerNote: order.buyerNote,
    buyerName: order.buyerName,
    buyerPhone: order.buyerPhone,
    subtotal: Number(order.subtotal),
    amountDue: order.amountDue,
    commissionRate: Number(order.commissionRate),
    commissionAmount: order.commissionAmount != null ? Number(order.commissionAmount) : null,
    paymentPhone: order.paymentPhone,
    paymentDeadline: order.paymentDeadline,
    mpesaReceiptNumber: order.mpesaReceiptNumber,
    paidAt: order.paidAt,
    lastPaymentError: order.lastPaymentError,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt,
    lines: order.lines.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      productName: l.productName,
      variantSku: l.variantSku,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
    })),
  };
}

/**
 * Online orders end to end: buyer checkout and payment (through the
 * business's own TUMA account), TUMA's payment callback, and the
 * business's accept -> ready -> complete / cancel workflow.
 *
 * Three ways in, three ways of establishing RLS context:
 * - buyer requests: app.current_buyer from the verified buyer JWT
 *   (runAsBuyer), plus the shop's tenant while creating an order
 *   (ShopCatalogService.runForShop)
 * - TUMA's callback: the organization id in the callback URL, after the
 *   URL's HMAC token has been verified
 * - business staff: the normal tenant context (TenantScopedPrismaService)
 */
@Injectable()
export class OnlineOrdersService {
  private readonly logger = new Logger(OnlineOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly catalog: ShopCatalogService,
    private readonly tuma: TumaClient,
    private readonly inventory: InventoryTransactionsService,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  // ── Shared helpers ─────────────────────────────────────────────────────

  private runAsBuyer<T>(buyerId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_buyer', ${buyerId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  private runAsTenant<T>(organizationId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Persists EXPIRED for unpaid orders past their window (views already compute it; this keeps filters honest). */
  private expireStale(tx: TenantTx) {
    return tx.onlineOrder.updateMany({
      where: { status: OnlineOrderStatus.PENDING_PAYMENT, paymentDeadline: { lte: new Date() } },
      data: { status: OnlineOrderStatus.EXPIRED },
    });
  }

  private encryptionKey(): Buffer {
    return parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
  }

  /**
   * TUMA callbacks carry no signature and TUMA has no status-lookup API,
   * so the callback URL itself is the credential: it embeds an HMAC of
   * the order id under a server-only key. Deterministic, so every payment
   * attempt for an order shares one callback URL - a late callback for an
   * earlier prompt still verifies, and a paid order is never missed.
   */
  private callbackToken(orderId: string): string {
    return createHmac('sha256', this.encryptionKey()).update(`tuma-callback:${orderId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, orderId: string): string {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/online-orders/${organizationId}/${orderId}/tuma-callback/${this.callbackToken(orderId)}`;
  }

  private async notifySms(to: string | null | undefined, message: string) {
    const phone = to ? normalizeKenyanPhone(to) : null;
    if (!phone) return;
    // Best effort - see SendSmsResult: a text failing never fails the action.
    await this.sms.sendSms({ to: `+${phone}`, message }).catch(() => undefined);
  }

  // ── Buyer: checkout and payment ───────────────────────────────────────

  async createOrder(buyerId: string, dto: CreateOnlineOrderDto) {
    const buyer = await this.prisma.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    const paymentPhone = dto.paymentPhone ? normalizeKenyanPhone(dto.paymentPhone) : buyer.phone;
    if (!paymentPhone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');

    // Same variant listed twice = one line with the combined quantity.
    const wanted = new Map<string, number>();
    for (const line of dto.lines) wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);

    let created: OrderWithLines | undefined;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await this.catalog.runForShop(
          dto.shopSlug,
          async (tx, shop) => {
            if (dto.fulfilmentType === FulfilmentType.PICKUP && !shop.pickupEnabled) {
              throw new BadRequestException('This shop does not offer pickup');
            }
            if (dto.fulfilmentType === FulfilmentType.DELIVERY) {
              if (!shop.deliveryEnabled) throw new BadRequestException('This shop does not deliver');
              if (!dto.deliveryAddress?.trim()) throw new BadRequestException('Enter a delivery address');
            }

            // Serializes checkouts per branch so two buyers can't both take
            // the last unit between the availability check and the insert.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'online-stock:' + shop.fulfilmentBranchId}))`;

            const variants = await tx.productVariant.findMany({
              where: { id: { in: [...wanted.keys()] }, recipeIngredients: { none: {} }, product: { onlineVisible: true } },
              include: { product: { select: { name: true } } },
            });
            if (variants.length !== wanted.size) {
              throw new BadRequestException('Some items in your cart are no longer available - refresh the shop and try again');
            }
            const available = await this.catalog.availableQuantities(tx, shop.fulfilmentBranchId, [...wanted.keys()]);

            const lines = variants.map((v) => {
              const quantity = wanted.get(v.id)!;
              assertQuantityMatchesMode(v.quantityMode, quantity, `Quantity for ${v.product.name}`);
              if ((available.get(v.id) ?? 0) < quantity) {
                throw new ConflictException(`Only ${available.get(v.id) ?? 0} of ${v.product.name} (${v.sku}) left`);
              }
              const unitPrice = Number(v.price);
              return {
                variantId: v.id,
                productName: v.product.name,
                variantSku: v.sku,
                quantity,
                unitPrice,
                lineTotal: roundMoney(unitPrice * quantity),
              };
            });
            const subtotal = roundMoney(lines.reduce((sum, l) => sum + l.lineTotal, 0));
            if (subtotal < 1) throw new BadRequestException('Order total must be at least KES 1');

            return tx.onlineOrder.create({
              data: {
                organizationId: shop.organizationId,
                buyerId,
                branchId: shop.fulfilmentBranchId,
                orderNumber: generateOrderNumber(),
                fulfilmentType: dto.fulfilmentType,
                deliveryAddress: dto.fulfilmentType === FulfilmentType.DELIVERY ? dto.deliveryAddress!.trim() : null,
                buyerNote: dto.note?.trim() || null,
                buyerName: dto.buyerName?.trim() || buyer.name,
                buyerPhone: buyer.phone,
                shopName: shop.displayName,
                shopSlug: shop.slug,
                subtotal,
                amountDue: Math.ceil(subtotal),
                commissionRate: shop.commissionRate ?? DEFAULT_COMMISSION_RATE,
                paymentPhone,
                paymentDeadline: new Date(Date.now() + PAYMENT_WINDOW_MS),
                lines: { create: lines },
              },
              include: { lines: true },
            });
          },
          { buyerId },
        );
      } catch (e) {
        // Order-number collision (1 in ~10^9) - just try another number.
        const collided =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          JSON.stringify(e.meta?.target ?? '').includes('orderNumber');
        if (!collided) throw e;
      }
    }
    if (!created) throw new ServiceUnavailableException('Could not create the order - try again');

    return this.startPayment(created);
  }

  async retryPayment(buyerId: string, orderId: string, paymentPhoneInput?: string) {
    const order = await this.runAsBuyer(buyerId, (tx) =>
      tx.onlineOrder.findUnique({ where: { id: orderId }, include: { lines: true } }),
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OnlineOrderStatus.PENDING_PAYMENT || order.paymentDeadline <= new Date()) {
      throw new BadRequestException('This order can no longer be paid - place a new order');
    }
    if (order.paymentAttemptedAt && Date.now() - order.paymentAttemptedAt.getTime() < RETRY_COOLDOWN_MS && !order.lastPaymentError) {
      throw new BadRequestException('Check your phone for the M-Pesa prompt - you can retry in a minute');
    }
    let paymentPhone = order.paymentPhone;
    if (paymentPhoneInput) {
      const normalized = normalizeKenyanPhone(paymentPhoneInput);
      if (!normalized) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
      paymentPhone = normalized;
    }
    return this.startPayment({ ...order, paymentPhone });
  }

  /**
   * Sends the M-Pesa prompt. A failure to START the payment (TUMA down,
   * shop's key revoked) doesn't fail the request - the order is returned
   * with lastPaymentError so the buyer can retry from their order page.
   */
  private async startPayment(order: OrderWithLines) {
    const store = await this.runAsTenant(order.organizationId, (tx) =>
      tx.onlineStore.findUnique({ where: { organizationId: order.organizationId } }),
    );
    let tumaPaymentId: string | null = null;
    let lastPaymentError: string | null = null;
    try {
      if (!store?.tumaEmail || !store.tumaApiKeyEncrypted || !store.addonActive) {
        throw new ServiceUnavailableException('This shop is not accepting payments right now');
      }
      const result = await this.tuma.stkPush(
        { email: store.tumaEmail, apiKey: decryptSecret(store.tumaApiKeyEncrypted, this.encryptionKey()) },
        {
          amount: order.amountDue,
          phone: order.paymentPhone,
          description: `${order.shopName} order ${order.orderNumber}`,
          callbackUrl: this.callbackUrl(order.organizationId, order.id),
        },
      );
      tumaPaymentId = result.paymentId;
    } catch (e) {
      lastPaymentError = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, orderId: order.id }, 'Online order STK push failed');
    }

    const updated = await this.runAsTenant(order.organizationId, (tx) =>
      tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          paymentPhone: order.paymentPhone,
          paymentAttemptedAt: new Date(),
          lastPaymentError,
          ...(tumaPaymentId ? { tumaPaymentId } : {}),
        },
        include: { lines: true },
      }),
    );
    return toOrderView(updated);
  }

  // ── Buyer: order history ──────────────────────────────────────────────

  async listForBuyer(buyerId: string) {
    const orders = await this.runAsBuyer(buyerId, async (tx) => {
      await this.expireStale(tx);
      return tx.onlineOrder.findMany({
        where: { buyerId },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
    return orders.map(toOrderView);
  }

  async getForBuyer(buyerId: string, orderId: string) {
    const order = await this.runAsBuyer(buyerId, (tx) =>
      tx.onlineOrder.findFirst({ where: { id: orderId, buyerId }, include: { lines: true } }),
    );
    if (!order) throw new NotFoundException('Order not found');
    return toOrderView(order);
  }

  /** Buyers can only cancel before paying - once paid, the money is with the business, so the business handles it. */
  async cancelByBuyer(buyerId: string, orderId: string) {
    const order = await this.runAsBuyer(buyerId, async (tx) => {
      const current = await tx.onlineOrder.findFirst({ where: { id: orderId, buyerId } });
      if (!current) throw new NotFoundException('Order not found');
      if (current.status !== OnlineOrderStatus.PENDING_PAYMENT) {
        throw new BadRequestException('Paid orders can only be cancelled by the shop - contact them directly');
      }
      return tx.onlineOrder.update({
        where: { id: orderId },
        data: { status: OnlineOrderStatus.CANCELLED, cancelledAt: new Date(), cancelledBy: 'BUYER', cancelReason: 'Cancelled by buyer' },
        include: { lines: true },
      });
    });
    return toOrderView(order);
  }

  // ── TUMA payment callback ─────────────────────────────────────────────

  /**
   * Trust model (TUMA callbacks are unsigned and there's no status API):
   * 1. The URL token must be this order's HMAC - only TUMA was given it.
   * 2. A "completed" callback must cover the full amount due and carry an
   *    M-Pesa receipt, which can only ever mark one order paid (unique).
   * 3. A "failed" callback only counts if it's for the latest prompt, so a
   *    stale failure can't override a newer successful attempt.
   * Completed payments are honoured even on an EXPIRED order - the buyer's
   * money has moved, so the business must see it (and can refund).
   */
  async handleTumaCallback(organizationId: string, orderId: string, token: string, body: TumaCallbackDto) {
    const expected = Buffer.from(this.callbackToken(orderId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new NotFoundException();
    }

    const status = typeof body.status === 'string' ? body.status.toLowerCase() : '';
    const paymentId = typeof body.payment_id === 'string' ? body.payment_id : null;
    const amount = Number(body.amount);
    const receipt = typeof body.mpesa_receipt_number === 'string' ? body.mpesa_receipt_number.trim() : '';

    let paidOrder: OnlineOrder | null = null;
    await this.runAsTenant(organizationId, async (tx) => {
      const order = await tx.onlineOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException();

      if (status === 'completed') {
        if (order.mpesaReceiptNumber && order.mpesaReceiptNumber === receipt) return; // duplicate delivery
        const payable = order.status === OnlineOrderStatus.PENDING_PAYMENT || order.status === OnlineOrderStatus.EXPIRED;
        if (!payable || !receipt || !Number.isFinite(amount) || amount < order.amountDue) {
          this.logger.error(
            { orderId, status: order.status, amount, amountDue: order.amountDue, receipt },
            'TUMA reported a completed payment that cannot be applied to this order - needs manual review',
          );
          await tx.onlineOrder.update({
            where: { id: orderId },
            data: { lastPaymentError: `Payment ${receipt || '(no receipt)'} of KES ${amount} could not be matched - contact the shop` },
          });
          return;
        }
        paidOrder = await tx.onlineOrder.update({
          where: { id: orderId },
          data: {
            status: OnlineOrderStatus.PAID,
            paidAt: new Date(),
            mpesaReceiptNumber: receipt,
            tumaPaymentId: paymentId ?? order.tumaPaymentId,
            lastPaymentError: null,
          },
        });
      } else if ((status === 'failed' || status === 'cancelled') && order.status === OnlineOrderStatus.PENDING_PAYMENT) {
        if (paymentId && order.tumaPaymentId && paymentId !== order.tumaPaymentId) return;
        await tx.onlineOrder.update({
          where: { id: orderId },
          data: { lastPaymentError: 'The M-Pesa payment was cancelled or failed - try again' },
        });
      }
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Receipt already used on another order - never mark two orders paid with one payment.
        this.logger.error({ orderId, receipt }, 'TUMA callback reused an M-Pesa receipt from another order');
        return;
      }
      throw e;
    });

    if (paidOrder) {
      const order = paidOrder as OnlineOrder;
      const store = await this.runAsTenant(organizationId, (tx) =>
        tx.onlineStore.findUnique({ where: { organizationId }, select: { contactPhone: true } }),
      );
      await this.notifySms(
        store?.contactPhone,
        `New Zaroda online order ${order.orderNumber}: KES ${order.amountDue} paid (M-Pesa ${order.mpesaReceiptNumber}). Open Online Orders to accept it.`,
      );
    }
    return { ok: true };
  }

  // ── Business: order handling ──────────────────────────────────────────

  async listForBusiness(status?: OnlineOrderStatus) {
    const orders = await this.tenantPrisma.run(async (tx) => {
      await this.expireStale(tx);
      return tx.onlineOrder.findMany({
        where: status ? { status } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    });
    return orders.map(toOrderView);
  }

  async getForBusiness(id: string) {
    const order = await this.tenantPrisma.run((tx) =>
      tx.onlineOrder.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!order) throw new NotFoundException('Order not found');
    return toOrderView(order);
  }

  private async transition(
    id: string,
    from: OnlineOrderStatus[],
    apply: (tx: TenantTx, order: OrderWithLines) => Promise<Prisma.OnlineOrderUpdateInput>,
  ) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.onlineOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!order) throw new NotFoundException('Order not found');
      if (!from.includes(order.status)) {
        throw new BadRequestException(`This order is ${order.status.toLowerCase().replace('_', ' ')} - that action isn't available`);
      }
      const data = await apply(tx, order);
      // Conditional on status so two staff clicking at once can't both apply.
      const result = await tx.onlineOrder.updateMany({ where: { id, status: order.status }, data: data as Prisma.OnlineOrderUpdateManyMutationInput });
      if (result.count === 0) throw new ConflictException('This order was just updated by someone else - refresh');
      return tx.onlineOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }

  /** Accepting commits the stock: each line is deducted from the fulfilment branch through the normal inventory ledger. */
  async accept(id: string) {
    const order = await this.transition(id, [OnlineOrderStatus.PAID], async (tx, current) => {
      for (const line of current.lines) {
        await this.inventory.recordInTx(tx, {
          branchId: current.branchId,
          variantId: line.variantId,
          type: InventoryTxnType.ONLINE_SALE,
          quantityDelta: -Number(line.quantity),
          referenceId: current.id,
        });
      }
      return { status: OnlineOrderStatus.ACCEPTED, acceptedAt: new Date(), stockCommitted: true };
    });
    return toOrderView(order);
  }

  async markReady(id: string) {
    const order = await this.transition(id, [OnlineOrderStatus.ACCEPTED], async () => ({
      status: OnlineOrderStatus.READY,
      readyAt: new Date(),
    }));
    await this.notifySms(
      order.buyerPhone,
      order.fulfilmentType === FulfilmentType.PICKUP
        ? `Your ${order.shopName} order ${order.orderNumber} is ready for pickup.`
        : `Your ${order.shopName} order ${order.orderNumber} is on its way.`,
    );
    return toOrderView(order);
  }

  /** Collected / delivered. This is the point commission becomes owed. */
  async complete(id: string) {
    const order = await this.transition(id, [OnlineOrderStatus.ACCEPTED, OnlineOrderStatus.READY], async (_tx, current) => ({
      status: OnlineOrderStatus.COMPLETED,
      completedAt: new Date(),
      commissionAmount: roundMoney(Number(current.subtotal) * Number(current.commissionRate)),
    }));
    return toOrderView(order);
  }

  /**
   * Business cancels. Stock already deducted is put back. If the buyer
   * had paid, the money is in the business's own account - the business
   * must refund it; the response's refundDue tells the UI to say so.
   */
  async cancelByBusiness(id: string, dto: CancelOnlineOrderDto) {
    const order = await this.transition(
      id,
      [OnlineOrderStatus.PENDING_PAYMENT, OnlineOrderStatus.PAID, OnlineOrderStatus.ACCEPTED, OnlineOrderStatus.READY],
      async (tx, current) => {
        if (current.stockCommitted) {
          for (const line of current.lines) {
            await this.inventory.recordInTx(tx, {
              branchId: current.branchId,
              variantId: line.variantId,
              type: InventoryTxnType.RETURN,
              quantityDelta: Number(line.quantity),
              referenceId: current.id,
            });
          }
        }
        return {
          status: OnlineOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: 'BUSINESS',
          cancelReason: dto.reason.trim(),
          stockCommitted: false,
        };
      },
    );
    await this.notifySms(
      order.buyerPhone,
      `Your ${order.shopName} order ${order.orderNumber} was cancelled by the shop: ${order.cancelReason}.` +
        (order.paidAt ? ` The shop will refund KES ${order.amountDue} to you.` : ''),
    );
    return { ...toOrderView(order), refundDue: order.paidAt ? order.amountDue : 0 };
  }
}

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
import { evaluateCallback, parseCallback } from '../online-store/tuma.util';
import { recordOnlineSale, voidOnlineSale } from './online-order-sale';
import { ShopCatalogService } from './shop-catalog.service';
import { CancelOnlineOrderDto, CreateOnlineOrderDto } from './dto/online-order.dto';
import { generateOrderNumber, normalizeKenyanPhone, roundMoney } from './online-orders.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
// How long an unpaid order holds stock. An M-Pesa prompt itself times out
// in about a minute; this leaves room for a retry or two.
const PAYMENT_WINDOW_MS = 15 * 60_000;
// A retry before this would risk two live prompts for one order.
const RETRY_COOLDOWN_MS = 60_000;
// "I've paid, check now" costs the shop KES 1 each time (Tuma's status check is
// paid; its callbacks are free), so it is rate limited.
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS_PER_ORDER = 5;

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
  // Per-process limits on paid "check now" presses (reset on restart; the cost is small).
  private readonly checks = new Map<string, { last: number; count: number }>();

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
    // A shopper who signed in by email has no phone on file until they give one here: it is
    // both the number M-Pesa prompts and how the shop reaches them about the order.
    const paymentPhone = dto.paymentPhone ? normalizeKenyanPhone(dto.paymentPhone) : buyer.phone;
    if (!paymentPhone) {
      throw new BadRequestException(
        dto.paymentPhone ? 'Enter a valid M-Pesa number, e.g. 0712 345 678' : 'Enter the M-Pesa phone number you will pay with, e.g. 0712 345 678',
      );
    }

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
                buyerPhone: paymentPhone,
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

    // Remember the number for next time. Best effort: a phone belongs to at most one
    // shopper account, so if another account already has it we simply don't save it.
    if (!buyer.phone) {
      await this.prisma.buyer.update({ where: { id: buyerId }, data: { phone: paymentPhone } }).catch(() => undefined);
    }

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
    let tumaMerchantRequestId: string | null = null;
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
      tumaMerchantRequestId = result.merchantRequestId;
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
          ...(tumaMerchantRequestId ? { tumaMerchantRequestId } : {}),
        },
        include: { lines: true },
      }),
    );
    return toOrderView(updated);
  }

  // ── Buyer: order history ──────────────────────────────────────────────

  private loadBuyerOrders(buyerId: string) {
    return this.runAsBuyer(buyerId, async (tx) => {
      await this.expireStale(tx);
      return tx.onlineOrder.findMany({
        where: { buyerId },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }

  // Plain reads. They never call Tuma: its status check costs KES 1 each,
  // charged to the shop, so polling it from a page would burn money. A payment
  // reaches us through Tuma's free callback (handleTumaCallback); the buyer's
  // "I've paid, check now" button (checkPaymentForBuyer) is the rare backup.
  async listForBuyer(buyerId: string) {
    return (await this.loadBuyerOrders(buyerId)).map(toOrderView);
  }

  private findBuyerOrder(buyerId: string, orderId: string) {
    return this.runAsBuyer(buyerId, (tx) => tx.onlineOrder.findFirst({ where: { id: orderId, buyerId }, include: { lines: true } }));
  }

  async getForBuyer(buyerId: string, orderId: string) {
    const order = await this.findBuyerOrder(buyerId, orderId);
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

  // ── Paying: Tuma's callback (free) and the backup status check (KES 1) ─

  /**
   * How a payment is learned about. Tuma confirmed (support, Oct 2026) that
   * webhooks are free and real-time while its status check costs KES 1 per
   * request, so the callback does the work:
   * 1. The URL token must be this order's HMAC - only Tuma was given the
   *    address, which is what proves the callback is Tuma's.
   * 2. The callback body must itself be complete and consistent
   *    (evaluateCallback: success, full amount, an M-Pesa receipt, the
   *    right payment request). The receipt is unique across orders, so one
   *    payment can only ever settle one order.
   * 3. A callback that is incomplete is never acted on as-is; it triggers
   *    one (paid) status check instead, and Tuma's answer decides.
   * A payment that completes after the order expired is still honoured -
   * the buyer's money has moved, so the shop must see it (and can refund).
   */
  async handleTumaCallback(organizationId: string, orderId: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.callbackToken(orderId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new NotFoundException();
    }

    // Field NAMES and the status word only - never amounts or receipts. Tuma publishes no
    // callback schema, so this is how a surprise in its real payload shows up in the logs.
    this.logger.log({ orderId, fields: Object.keys(body ?? {}), status: (body as { status?: unknown })?.status }, 'Tuma order callback received');
    const order = await this.runAsTenant(organizationId, (tx) => tx.onlineOrder.findUnique({ where: { id: orderId } }));
    if (!order) throw new NotFoundException();
    // Already settled (e.g. a duplicate delivery) - nothing to do.
    if (order.status !== OnlineOrderStatus.PENDING_PAYMENT && order.status !== OnlineOrderStatus.EXPIRED) return { ok: true };

    const verdict = evaluateCallback(body, { amount: order.amountDue, latestRequestId: order.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);

    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, order, verdict.receipt, merchantRequestId ?? order.tumaMerchantRequestId ?? undefined);
        break;
      case 'review':
        this.logger.error({ orderId, detail: verdict.detail }, 'Tuma reported a payment that does not match the order - needs manual review');
        await this.flag(organizationId, orderId, `A payment was received that doesn't match this order (${verdict.detail}). Contact the shop.`);
        break;
      case 'failed':
        // A failure for the CURRENT prompt lets the buyer retry at once; one for an earlier prompt is ignored.
        if (order.status === OnlineOrderStatus.PENDING_PAYMENT && (!merchantRequestId || !order.tumaMerchantRequestId || merchantRequestId === order.tumaMerchantRequestId)) {
          await this.flag(organizationId, orderId, 'The M-Pesa payment was cancelled or failed - try again');
        }
        break;
      case 'needs-check':
        this.logger.warn({ orderId, reason: verdict.reason }, 'Callback was not complete enough to trust - asking Tuma (KES 1)');
        await this.verifyWithTuma(organizationId, orderId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return { ok: true };
  }

  /** A short note on the order, shown to the buyer and the shop. */
  private flag(organizationId: string, orderId: string, message: string) {
    return this.runAsTenant(organizationId, (tx) => tx.onlineOrder.update({ where: { id: orderId }, data: { lastPaymentError: message } }));
  }

  /**
   * Marks the order PAID. Conditional on still being unpaid, so a callback
   * and a manual confirmation racing each other settle (and text the shop)
   * only once.
   */
  private async settle(
    organizationId: string,
    order: OnlineOrder,
    receipt: string,
    requestId?: string,
  ): Promise<'paid' | 'skipped' | 'review'> {
    try {
      const settled = await this.runAsTenant(organizationId, async (tx) => {
        const result = await tx.onlineOrder.updateMany({
          where: { id: order.id, status: { in: [OnlineOrderStatus.PENDING_PAYMENT, OnlineOrderStatus.EXPIRED] } },
          data: {
            status: OnlineOrderStatus.PAID,
            paidAt: new Date(),
            mpesaReceiptNumber: receipt,
            ...(requestId ? { tumaMerchantRequestId: requestId } : {}),
            lastPaymentError: null,
          },
        });
        if (result.count !== 1) return null;
        const store = await tx.onlineStore.findUnique({ where: { organizationId }, select: { contactPhone: true } });
        return { contactPhone: store?.contactPhone };
      });
      if (!settled) return 'skipped';
      await this.notifySms(
        settled.contactPhone,
        `New Zaroda online order ${order.orderNumber}: KES ${order.amountDue} paid (M-Pesa ${receipt}). Open Online Orders to accept it.`,
      );
      return 'paid';
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Receipt already used on another order - never mark two orders paid with one payment.
        this.logger.error({ orderId: order.id, receipt }, 'That M-Pesa receipt already settled a different order');
        return 'review';
      }
      throw e;
    }
  }

  /**
   * Asks Tuma's status API whether this order's latest payment went through.
   * KES 1 per call, charged to the SHOP's Tuma account - so only for the
   * backup cases (incomplete callback, or someone pressing "check now").
   */
  private async verifyWithTuma(
    organizationId: string,
    orderId: string,
  ): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const { order, store } = await this.runAsTenant(organizationId, async (tx) => ({
      order: await tx.onlineOrder.findUnique({ where: { id: orderId } }),
      store: await tx.onlineStore.findUnique({ where: { organizationId } }),
    }));
    if (!order || !store?.tumaEmail || !store.tumaApiKeyEncrypted || !order.tumaMerchantRequestId) return 'skipped';
    if (order.status !== OnlineOrderStatus.PENDING_PAYMENT && order.status !== OnlineOrderStatus.EXPIRED) return 'skipped';

    const requestId = order.tumaMerchantRequestId;
    const confirmation = await this.tuma.confirmPayment(
      { email: store.tumaEmail, apiKey: decryptSecret(store.tumaApiKeyEncrypted, this.encryptionKey()) },
      requestId,
      order.amountDue,
    );

    if (confirmation.outcome === 'review') {
      this.logger.error({ orderId, detail: confirmation.detail }, 'Tuma reported a payment that does not match the order - needs manual review');
      await this.flag(organizationId, orderId, `A payment was received that doesn't match this order (${confirmation.detail}). Contact the shop.`);
      return 'review';
    }
    if (confirmation.outcome === 'unavailable') {
      this.logger.error({ orderId, detail: confirmation.detail }, 'Could not check this payment with Tuma');
      await this.flag(
        organizationId,
        orderId,
        'We could not confirm the payment with Tuma just now. If you have paid, the shop can confirm it from its Online Orders page.',
      );
      return 'unavailable';
    }
    if (confirmation.outcome !== 'paid') return 'unconfirmed';

    // Tuma sometimes gives no receipt; the request id is just as unique a
    // guard against one payment settling two orders.
    const outcome = await this.settle(organizationId, order, confirmation.mpesaReceipt?.trim() || `TUMA:${requestId}`, requestId);
    return outcome === 'review' ? 'review' : 'paid';
  }

  /**
   * "I've paid, check now" - the buyer's backup when no callback arrived.
   * Each press costs the shop KES 1, so it is limited: a cooldown between
   * presses and a cap per order.
   */
  async checkPaymentForBuyer(buyerId: string, orderId: string) {
    const order = await this.findBuyerOrder(buyerId, orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OnlineOrderStatus.PENDING_PAYMENT || !order.tumaMerchantRequestId) {
      return { ...toOrderView(order), checkResult: 'not-needed' as const };
    }
    const state = this.checks.get(order.id) ?? { last: 0, count: 0 };
    if (Date.now() - state.last < CHECK_COOLDOWN_MS) {
      throw new BadRequestException('Please wait about 30 seconds before checking again');
    }
    if (state.count >= MAX_CHECKS_PER_ORDER) {
      throw new BadRequestException('This order has been checked several times already - please contact the shop with your M-Pesa message');
    }
    this.checks.set(order.id, { last: Date.now(), count: state.count + 1 });

    const result = await this.verifyWithTuma(order.organizationId, order.id);
    const updated = (await this.findBuyerOrder(buyerId, orderId)) ?? order;
    return {
      ...toOrderView(updated),
      checkResult: (result === 'paid' ? 'paid' : result === 'unconfirmed' ? 'not-paid-yet' : result === 'unavailable' ? 'unavailable' : 'not-needed') as
        | 'paid'
        | 'not-paid-yet'
        | 'unavailable'
        | 'not-needed',
    };
  }

  /**
   * The shop confirms a payment by hand - for when it can see the M-Pesa
   * message (or the Tuma portal) but the automatic confirmation didn't come.
   * It is the shop's own money, so the shop's word is enough; the receipt
   * is required and, like any other, can only belong to one order.
   */
  async confirmPaymentByBusiness(id: string, receipt: string) {
    const cleaned = receipt.trim().toUpperCase();
    try {
      const order = await this.tenantPrisma.run(async (tx) => {
        const current = await tx.onlineOrder.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Order not found');
        const result = await tx.onlineOrder.updateMany({
          where: { id, status: { in: [OnlineOrderStatus.PENDING_PAYMENT, OnlineOrderStatus.EXPIRED] } },
          data: { status: OnlineOrderStatus.PAID, paidAt: new Date(), mpesaReceiptNumber: cleaned, lastPaymentError: null },
        });
        if (result.count !== 1) throw new BadRequestException('Only an order that is waiting for payment can be marked as paid');
        return tx.onlineOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      });
      return toOrderView(order);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('That M-Pesa receipt is already attached to another order');
      }
      throw e;
    }
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
    apply: (tx: TenantTx, order: OrderWithLines) => Promise<Prisma.OnlineOrderUncheckedUpdateManyInput>,
  ) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.onlineOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!order) throw new NotFoundException('Order not found');
      if (!from.includes(order.status)) {
        throw new BadRequestException(`This order is ${order.status.toLowerCase().replace('_', ' ')} - that action isn't available`);
      }
      const data = await apply(tx, order);
      // Conditional on status so two staff clicking at once can't both apply.
      const result = await tx.onlineOrder.updateMany({ where: { id, status: order.status }, data });
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
      const saleId = await recordOnlineSale(tx, current);
      return { status: OnlineOrderStatus.ACCEPTED, acceptedAt: new Date(), stockCommitted: true, saleId };
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
        await voidOnlineSale(tx, current.saleId);
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

import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SalesEarningStatus, SalesPayout, SalesPayoutSettings, SalesPayoutStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { TumaClient } from '../online-store/tuma.client';
import { ManualPayoutDto, ResolvePayoutDto, UpdatePayoutSettingsDto } from './dto/sales-earnings.dto';
import { MpesaB2cClient, ParsedB2cResult } from './mpesa-b2c.client';
import { nairobiMonth, round2, withholdTax } from './sales-earnings.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
export const GATEWAYS = ['MANUAL', 'MPESA_B2C', 'TUMA'] as const;
export type Gateway = (typeof GATEWAYS)[number];

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export const toPayoutView = (p: SalesPayout & { agent?: { fullName: string } }) => ({
  id: p.id,
  agentId: p.agentId,
  fullName: p.agent?.fullName,
  amountKes: num(p.amountKes),
  taxWithheldKes: num(p.taxWithheldKes),
  netKes: round2(num(p.amountKes) - num(p.taxWithheldKes)),
  throughMonth: p.throughMonth,
  gateway: p.method,
  reference: p.reference,
  status: p.status,
  failureReason: p.failureReason,
  createdAt: p.createdAt,
  paidAt: p.paidAt,
});

/**
 * Paying the teams. Earnings that have finished their hold are PAYABLE; a payout takes everything payable for one
 * person, holds back withholding tax, and either goes out through a gateway (M-Pesa B2C or TUMA, QUEUED until the
 * gateway confirms) or is recorded by an admin as paid by hand, with a reference. The earnings are marked PAID with
 * the payout in the same transaction that creates it - and only the ones still payable - so a double click, or two
 * admins at once, can never pay the same earnings twice. A failed payout puts its earnings back to PAYABLE.
 * Balances under the minimum carry over to the next run.
 */
@Injectable()
export class SalesPayoutsService {
  private readonly logger = new Logger(SalesPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly b2c: MpesaB2cClient,
    private readonly tuma: TumaClient,
  ) {}

  // ── Settings ─────────────────────────────────────────────────────────

  async getSettings(): Promise<SalesPayoutSettings> {
    return this.prisma.salesPayoutSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
  }

  toSettingsView(s: SalesPayoutSettings) {
    return {
      payoutGateway: s.payoutGateway as Gateway,
      payoutMinKes: num(s.payoutMinKes),
      payoutDay: s.payoutDay,
      holdDays: s.holdDays,
      withholdingTaxRate: num(s.withholdingTaxRate),
      available: { MANUAL: true, MPESA_B2C: this.b2c.isConfigured(), TUMA: this.tuma.hasPayoutSupport() },
    };
  }

  async settingsView() {
    return this.toSettingsView(await this.getSettings());
  }

  async updateSettings(platformAdminId: string, dto: UpdatePayoutSettingsDto) {
    if (dto.payoutGateway === 'MPESA_B2C' && !this.b2c.isConfigured()) throw new BadRequestException('M-Pesa B2C is not set up on this server (the MPESA_B2C_* settings are missing)');
    if (dto.payoutGateway === 'TUMA' && !this.tuma.hasPayoutSupport()) throw new BadRequestException('TUMA payouts are not set up on this server (TUMA_EMAIL, TUMA_API_KEY and TUMA_PAYOUT_PATH are needed)');
    const updated = await this.prisma.salesPayoutSettings.upsert({
      where: { id: 'default' },
      update: { payoutGateway: dto.payoutGateway, payoutMinKes: dto.payoutMinKes, payoutDay: dto.payoutDay, holdDays: dto.holdDays, withholdingTaxRate: dto.withholdingTaxRate },
      create: { id: 'default', payoutGateway: dto.payoutGateway, payoutMinKes: dto.payoutMinKes, payoutDay: dto.payoutDay, holdDays: dto.holdDays, withholdingTaxRate: dto.withholdingTaxRate },
    });
    await this.prisma.platformAuditLog.create({ data: { platformAdminId, action: 'sales_payout_settings.update', entityType: 'SalesPayoutSettings', entityId: 'default' } });
    return this.toSettingsView(updated);
  }

  // ── Making a payout ──────────────────────────────────────────────────

  /**
   * Takes everything payable for a person (up to a month, if given) into one payout. Returns null when there is
   * nothing payable or it is under the minimum (it carries over). `status` is QUEUED for a gateway payout and
   * PAID for one recorded by hand.
   */
  private async createPayout(agentId: string, opts: { gateway: Gateway; throughMonth?: string; reference?: string; platformAdminId?: string }) {
    const settings = await this.getSettings();
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.salesEarning.findMany({
        where: { agentId, status: SalesEarningStatus.PAYABLE, payoutId: null, ...(opts.throughMonth ? { periodMonth: { lte: opts.throughMonth } } : {}) },
        select: { id: true, amountKes: true, periodMonth: true },
      });
      const gross = round2(due.reduce((t, e) => t + num(e.amountKes), 0));
      if (due.length === 0 || gross <= 0 || gross < num(settings.payoutMinKes)) return null;
      const { tax } = withholdTax(gross, num(settings.withholdingTaxRate));
      const manual = opts.gateway === 'MANUAL';
      const payout = await tx.salesPayout.create({
        data: {
          agentId,
          amountKes: gross,
          taxWithheldKes: tax,
          throughMonth: opts.throughMonth ?? due.reduce((m, e) => (e.periodMonth > m ? e.periodMonth : m), '0000-00'),
          method: opts.gateway,
          reference: opts.reference?.trim() || null,
          status: manual ? SalesPayoutStatus.PAID : SalesPayoutStatus.QUEUED,
          paidAt: manual ? new Date() : null,
          recordedByPlatformAdminId: opts.platformAdminId ?? null,
          gatewayRequestId: manual ? null : randomUUID(),
        },
      });
      const marked = await tx.salesEarning.updateMany({
        where: { id: { in: due.map((e) => e.id) }, status: SalesEarningStatus.PAYABLE, payoutId: null },
        data: { status: SalesEarningStatus.PAID, payoutId: payout.id },
      });
      if (marked.count !== due.length) throw new BadRequestException('Those earnings were just paid by someone else - refresh and check');
      if (opts.platformAdminId) await tx.platformAuditLog.create({ data: { platformAdminId: opts.platformAdminId, action: 'sales_payout.create', entityType: 'SalesPayout', entityId: payout.id } });
      return payout;
    }, TX_OPTIONS);
  }

  /** The admin records that they paid someone by hand (M-Pesa app, bank, cash), with the reference. */
  async recordManual(platformAdminId: string, dto: ManualPayoutDto) {
    if (!(await this.prisma.salesAgent.findUnique({ where: { id: dto.agentId }, select: { id: true } }))) throw new BadRequestException('Person not found');
    const payout = await this.createPayout(dto.agentId, { gateway: 'MANUAL', throughMonth: dto.throughMonth, reference: dto.reference, platformAdminId });
    if (!payout) throw new BadRequestException('Nothing payable to this person yet, or it is below the payout minimum - it carries over to the next run');
    return toPayoutView(payout);
  }

  /** Sends one person's payable balance through the gateway they are set up for. Admin "Pay now". */
  async sendNow(platformAdminId: string, agentId: string) {
    const agent = await this.prisma.salesAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Person not found');
    const settings = await this.getSettings();
    const gateway = this.gatewayFor(agent, settings);
    if (gateway === 'MANUAL') throw new BadRequestException('No payout gateway is set up for this person - record the payment by hand instead');
    const payout = await this.createPayout(agentId, { gateway, platformAdminId });
    if (!payout) throw new BadRequestException('Nothing payable to this person yet, or it is below the payout minimum - it carries over to the next run');
    return toPayoutView(await this.dispatch(payout, agent.payoutAccount, agent.fullName));
  }

  private gatewayFor(agent: { payoutGateway: string | null; payoutAccount: string | null }, settings: SalesPayoutSettings): Gateway {
    const wanted = (agent.payoutGateway ?? settings.payoutGateway) as Gateway;
    if (wanted === 'MPESA_B2C' && this.b2c.isConfigured() && agent.payoutAccount) return wanted;
    if (wanted === 'TUMA' && this.tuma.hasPayoutSupport() && agent.payoutAccount) return wanted;
    return 'MANUAL';
  }

  /** Hands a queued payout to its gateway. The gateway refusing it outright fails the payout (earnings return to payable). */
  private async dispatch(payout: SalesPayout, account: string | null, name: string): Promise<SalesPayout> {
    const phone = normalizeKenyanPhone(account ?? '');
    const net = round2(num(payout.amountKes) - num(payout.taxWithheldKes));
    try {
      if (!phone) throw new BadRequestException('This person has no valid M-Pesa phone number on file');
      if (net < 1) throw new BadRequestException('Nothing is left to send after tax');
      // M-Pesa only moves whole shillings; the cents (at most 99) stay as a rounding difference on this payout.
      const amount = Math.floor(net);
      if (payout.method === 'MPESA_B2C') {
        await this.b2c.send({ requestId: payout.gatewayRequestId as string, phone, amount, remarks: `Zaroda commission payout for ${name}` });
      } else if (payout.method === 'TUMA') {
        const sent = await this.tuma.sendMoney({ amount, phone, description: `Zaroda commission payout for ${name}`, reference: payout.gatewayRequestId as string });
        if (sent.requestId) return this.prisma.salesPayout.update({ where: { id: payout.id }, data: { gatewayRequestId: sent.requestId } });
      }
      return payout;
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'The payout could not be sent';
      return this.fail(payout.id, reason);
    }
  }

  /** Marks a payout failed and puts its earnings back to payable. */
  private async fail(payoutId: string, reason: string): Promise<SalesPayout> {
    return this.prisma.$transaction(async (tx) => {
      const failed = await tx.salesPayout.updateMany({ where: { id: payoutId, status: SalesPayoutStatus.QUEUED }, data: { status: SalesPayoutStatus.FAILED, failureReason: reason.slice(0, 500) } });
      if (failed.count === 1) await tx.salesEarning.updateMany({ where: { payoutId }, data: { status: SalesEarningStatus.PAYABLE, payoutId: null } });
      return tx.salesPayout.findUniqueOrThrow({ where: { id: payoutId } });
    }, TX_OPTIONS);
  }

  /** Marks a queued payout paid. Only a QUEUED payout can be settled, so a repeated callback changes nothing. */
  private async succeed(payoutId: string, reference: string | null): Promise<SalesPayout> {
    await this.prisma.salesPayout.updateMany({ where: { id: payoutId, status: SalesPayoutStatus.QUEUED }, data: { status: SalesPayoutStatus.PAID, paidAt: new Date(), reference } });
    return this.prisma.salesPayout.findUniqueOrThrow({ where: { id: payoutId } });
  }

  /** Safaricom's B2C result: success settles the payout, failure returns its earnings to payable. */
  async settleB2c(result: ParsedB2cResult) {
    if (!result.originatorConversationId) return;
    const payout = await this.prisma.salesPayout.findFirst({ where: { gatewayRequestId: result.originatorConversationId, method: 'MPESA_B2C' } });
    if (!payout || payout.status !== SalesPayoutStatus.QUEUED) return;
    if (result.resultCode === 0) {
      const expected = Math.floor(num(payout.amountKes) - num(payout.taxWithheldKes));
      if (result.amount !== undefined && Math.abs(result.amount - expected) > 0.009) {
        // Safaricom says it sent a different sum than we asked for: do not settle it automatically.
        this.logger.error({ payoutId: payout.id, expected, reported: result.amount }, 'B2C amount mismatch - left QUEUED for review');
        return;
      }
      await this.succeed(payout.id, result.receipt ?? null);
    } else {
      await this.fail(payout.id, result.resultDesc ?? `M-Pesa result code ${result.resultCode}`);
    }
  }

  /** For a payout stuck QUEUED (a lost callback, or TUMA): the admin says what actually happened. */
  async resolve(platformAdminId: string, payoutId: string, dto: ResolvePayoutDto) {
    const payout = await this.prisma.salesPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== SalesPayoutStatus.QUEUED) throw new BadRequestException('Only a queued payout can be resolved');
    if (dto.outcome === 'PAID' && !dto.reference?.trim()) throw new BadRequestException('Enter the payment reference');
    const updated = dto.outcome === 'PAID' ? await this.succeed(payoutId, dto.reference!.trim()) : await this.fail(payoutId, dto.reason?.trim() || 'Marked failed by an admin');
    await this.prisma.platformAuditLog.create({ data: { platformAdminId, action: `sales_payout.resolve_${dto.outcome.toLowerCase()}`, entityType: 'SalesPayout', entityId: payoutId } });
    return toPayoutView(updated);
  }

  async list(agentId: string | undefined) {
    const rows = await this.prisma.salesPayout.findMany({ where: agentId ? { agentId } : undefined, orderBy: { createdAt: 'desc' }, take: 100, include: { agent: { select: { fullName: true } } } });
    return rows.map(toPayoutView);
  }

  // ── The monthly run ──────────────────────────────────────────────────

  /**
   * On or after the payout day, once per month: sends every payable balance at or over the minimum through the
   * gateway its owner is set up for. People with no gateway (or none set up on the server) are left payable for the
   * admin to pay by hand. Does nothing when the platform is in MANUAL mode.
   */
  async runDue(now = new Date()): Promise<{ ran: boolean; sent: number; failed: number }> {
    const settings = await this.getSettings();
    const month = nairobiMonth(now);
    const dayOfMonth = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric' }).format(now));
    if (settings.payoutGateway === 'MANUAL' || dayOfMonth < settings.payoutDay || settings.lastRunMonth === month) return { ran: false, sent: 0, failed: 0 };

    // Claim the month first (only one server wins), so a crash half-way never pays anyone twice.
    const claimed = await this.prisma.salesPayoutSettings.updateMany({ where: { id: 'default', OR: [{ lastRunMonth: null }, { lastRunMonth: { not: month } }] }, data: { lastRunMonth: month } });
    if (claimed.count === 0) return { ran: false, sent: 0, failed: 0 };

    const balances = await this.prisma.salesEarning.groupBy({ by: ['agentId'], where: { status: SalesEarningStatus.PAYABLE, payoutId: null }, _sum: { amountKes: true } });
    let sent = 0;
    let failed = 0;
    for (const b of balances) {
      if (num(b._sum.amountKes) < num(settings.payoutMinKes)) continue;
      const agent = await this.prisma.salesAgent.findUnique({ where: { id: b.agentId } });
      if (!agent) continue;
      const gateway = this.gatewayFor(agent, settings);
      if (gateway === 'MANUAL') continue;
      try {
        const payout = await this.createPayout(agent.id, { gateway });
        if (!payout) continue;
        const done = await this.dispatch(payout, agent.payoutAccount, agent.fullName);
        if (done.status === SalesPayoutStatus.FAILED) failed++;
        else sent++;
      } catch (e) {
        failed++;
        this.logger.error({ err: e, agentId: agent.id }, 'Scheduled payout failed');
      }
    }
    return { ran: true, sent, failed };
  }
}

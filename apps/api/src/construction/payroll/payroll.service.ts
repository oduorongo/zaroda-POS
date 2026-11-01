import { randomBytes, randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../../common/crypto/secret-box';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { tenantContext } from '../../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../../notifications/africas-talking-sms.provider';
import { B2cAccount, MpesaB2cClient, parseB2cResult } from '../../sales-teams/mpesa-b2c.client';
import { ConContext, Tx, asOrg } from '../common/con-access';
import { todayKey } from '../compliance/compliance.util';
import { PayoutSettingsDto, PayrollPayDto, PayrollRunDto } from '../dto/payroll-portal.dto';
import { nextCode } from '../projects/projects.util';
import { r2 } from '../commercial/valuation.util';
import { dayValue, maskPhone } from '../site/site.util';
import { PAYROLL_KEYS, casualDeductions, mpesaPhone, payrollRates, payslipText, periodDays } from './payroll.util';
import { PageQueryDto, pageOf } from '../dto/query.dto';
import { smsParts } from '../plans/con-addons.util';
import { ConUsageService } from '../plans/con-usage.service';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const MAX_DAYS = 31;
const METHOD_LABEL = { MPESA: 'M-Pesa', MPESA_MANUAL: 'M-Pesa', CASH: 'cash' } as const;

/**
 * Casual labour payroll (docs/construction/01 s8): a run per project and period, worked out from the muster roll, with
 * statutory deductions from con_tax_settings in force at the end of the period. Made by one person, approved by another,
 * then paid from the business's own M-Pesa B2C account (or marked paid in cash / by hand), with a payslip by SMS.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly b2c: MpesaB2cClient,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
    private readonly usage: ConUsageService,
  ) {}

  private key() {
    return parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
  }

  private async rates(tx: Tx, at: Date) {
    const rows = await tx.conTaxSetting.findMany({ where: { key: { in: PAYROLL_KEYS }, effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: 'asc' } });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) latest.set(r.key, r);
    const active = new Map(Array.from(latest.values()).filter((r) => r.active).map((r) => [r.key, { rate: n(r.rate), threshold: r.threshold === null ? null : n(r.threshold) }]));
    return payrollRates(active);
  }

  async list(projectId: string, page?: PageQueryDto) {
    const rows = await this.tenantPrisma.run((tx) => tx.conPayrollRun.findMany({ where: { projectId }, orderBy: { periodStart: 'desc' }, ...pageOf(page) }));
    return rows.map((r) => ({ id: r.id, number: r.number, periodStart: day(r.periodStart), periodEnd: day(r.periodEnd), status: r.status, workers: r.workers, gross: n(r.gross), deductions: n(r.deductions), net: n(r.net), createdBy: r.createdBy, approvedAt: r.approvedAt, paidAt: r.paidAt }));
  }

  private async view(tx: Tx, id: string) {
    const r = await tx.conPayrollRun.findUniqueOrThrow({ where: { id }, include: { lines: { include: { worker: { select: { name: true, trade: true, phone: true } } }, orderBy: { worker: { name: 'asc' } } } } });
    const [settings, fees, sub] = await Promise.all([
      tx.conPayoutSettings.findUnique({ where: { organizationId: r.organizationId } }),
      tx.conFeeCharge.aggregate({ where: { sourceId: { in: r.lines.map((l) => `payout:${l.id}`) } }, _sum: { amount: true }, _count: { _all: true } }),
      tx.conSubscription.findUnique({ where: { organizationId: r.organizationId }, select: { smsCredits: true } }),
    ]);
    return {
      payoutFees: { count: fees._count._all, total: n(fees._sum.amount) }, smsCredits: sub?.smsCredits ?? 0,
      id: r.id, number: r.number, periodStart: day(r.periodStart), periodEnd: day(r.periodEnd), status: r.status, workers: r.workers, gross: n(r.gross), deductions: n(r.deductions), net: n(r.net), notes: r.notes,
      createdBy: r.createdBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt, paidAt: r.paidAt, mpesaReady: payoutReady(settings),
      lines: r.lines.map((l) => ({
        id: l.id, workerId: l.workerId, name: l.worker.name, trade: l.worker.trade, phone: maskPhone(l.worker.phone), canMpesa: !!mpesaPhone(l.worker.phone),
        days: n(l.days), dailyRate: n(l.dailyRate), gross: n(l.gross), nssf: n(l.nssf), shif: n(l.shif), housingLevy: n(l.housingLevy), paye: n(l.paye), deductions: n(l.deductions), net: n(l.net),
        status: l.status, method: l.method, reference: l.reference, failureReason: l.failureReason, paidAt: l.paidAt, smsSent: !!l.smsSentAt,
      })),
    };
  }

  async get(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.load(tx, projectId, id);
      return this.view(tx, id);
    });
  }

  private async load(tx: Tx, projectId: string, id: string) {
    const r = await tx.conPayrollRun.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Pay run not found');
    return r;
  }

  async create(con: ConContext, projectId: string, dto: PayrollRunDto) {
    if (dto.periodEnd < dto.periodStart) throw new BadRequestException('The period ends before it starts.');
    if (dto.periodEnd > todayKey()) throw new BadRequestException('A pay run cannot include days that have not happened yet.');
    const days = periodDays(dto.periodStart, dto.periodEnd);
    if (days > MAX_DAYS) throw new BadRequestException(`A pay run covers at most ${MAX_DAYS} days.`);
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.conProject.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Project not found');
      const clash = await tx.conPayrollRun.findFirst({ where: { projectId, periodStart: { lte: date(dto.periodEnd) }, periodEnd: { gte: date(dto.periodStart) } } });
      if (clash) throw new ConflictException(`${clash.number} already covers some of these days (${day(clash.periodStart)} to ${day(clash.periodEnd)}).`);
      const muster = await tx.conMuster.findMany({ where: { projectId, date: { gte: date(dto.periodStart), lte: date(dto.periodEnd) }, status: { not: 'ABSENT' } }, include: { worker: { select: { id: true, dailyRate: true } } } });
      const byWorker = new Map<string, { days: number; rate: number }>();
      for (const m of muster) {
        const w = byWorker.get(m.workerId) ?? { days: 0, rate: n(m.worker.dailyRate) };
        w.days += dayValue(m.status);
        byWorker.set(m.workerId, w);
      }
      if (!byWorker.size) throw new BadRequestException('Nobody is marked present on the muster roll for these days.');
      const rates = await this.rates(tx, date(dto.periodEnd));
      const lines = Array.from(byWorker.entries()).map(([workerId, w]) => {
        const gross = r2(w.days * w.rate);
        return { workerId, days: w.days, dailyRate: w.rate, gross, ...casualDeductions(gross, days, rates) };
      });
      const sum = (k: 'gross' | 'deductions' | 'net') => r2(lines.reduce((a, l) => a + l[k], 0));
      const numbers = (await tx.conPayrollRun.findMany({ where: { projectId }, select: { number: true } })).map((r) => r.number);
      const run = await tx.conPayrollRun.create({
        data: {
          organizationId: con.organizationId, projectId, number: nextCode('PAY', numbers), periodStart: date(dto.periodStart), periodEnd: date(dto.periodEnd), notes: dto.notes?.trim() || null, createdBy: con.orgUserId,
          workers: lines.length, gross: sum('gross'), deductions: sum('deductions'), net: sum('net'),
          lines: { create: lines.map((l) => ({ organizationId: con.organizationId, workerId: l.workerId, days: l.days, dailyRate: l.dailyRate, gross: l.gross, nssf: l.nssf, shif: l.shif, housingLevy: l.housingLevy, paye: l.paye, deductions: l.deductions, net: l.net })) },
        },
      });
      await this.audit.logInTx(tx, { action: 'con_payroll.created', entityType: 'ConPayrollRun', entityId: run.id, after: { number: run.number, periodStart: dto.periodStart, periodEnd: dto.periodEnd, workers: lines.length, gross: sum('gross'), net: sum('net') } });
      return this.view(tx, run.id);
    });
  }

  async remove(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await this.load(tx, projectId, id);
      if (r.status !== 'DRAFT') throw new ConflictException('Only a draft pay run can be deleted.');
      await tx.conPayrollRun.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_payroll.deleted', entityType: 'ConPayrollRun', entityId: id, before: { number: r.number, net: n(r.net) } });
      return { ok: true };
    });
  }

  async approve(con: ConContext, projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await this.load(tx, projectId, id);
      if (r.status !== 'DRAFT') throw new ConflictException(`${r.number} is already ${r.status.toLowerCase()}.`);
      if (r.createdBy === con.orgUserId) throw new ForbiddenException('You prepared this pay run, so someone else must approve it.');
      await tx.conPayrollRun.update({ where: { id }, data: { status: 'APPROVED', approvedBy: con.orgUserId, approvedAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'con_payroll.approved', entityType: 'ConPayrollRun', entityId: id, before: { status: r.status }, after: { status: 'APPROVED', net: n(r.net) } });
      return this.view(tx, id);
    });
  }

  /** Cash or a hand-made M-Pesa payment is settled at once; M-Pesa B2C is sent now and settled when Safaricom's result arrives. */
  async pay(con: ConContext, projectId: string, id: string, dto: PayrollPayDto) {
    if (dto.method === 'MPESA_MANUAL' && !dto.reference?.trim()) throw new BadRequestException('Enter the M-Pesa code of the payment.');
    const prepared = await this.tenantPrisma.run(async (tx) => {
      const r = await this.load(tx, projectId, id);
      if (r.status === 'DRAFT') throw new ConflictException('Approve the pay run before paying it.');
      if (r.status === 'PAID') throw new ConflictException(`${r.number} is already paid.`);
      const lines = await tx.conPayrollLine.findMany({ where: { runId: id, status: { in: ['UNPAID', 'FAILED'] }, ...(dto.lineIds ? { id: { in: dto.lineIds } } : {}) }, include: { worker: true } });
      if (!lines.length) throw new ConflictException('Nobody selected is waiting to be paid.');
      if (dto.method !== 'MPESA') {
        for (const l of lines) {
          await tx.conPayrollLine.update({ where: { id: l.id }, data: { status: 'PAID', method: dto.method, reference: dto.reference?.trim() || null, paidAt: new Date(), paidBy: con.orgUserId, failureReason: null } });
        }
        await this.audit.logInTx(tx, { action: 'con_payroll.paid', entityType: 'ConPayrollRun', entityId: id, after: { method: dto.method, reference: dto.reference ?? null, lines: lines.length, amount: r2(lines.reduce((a, l) => a + n(l.net), 0)) } });
        await this.settleRun(tx, id);
        return { run: r, send: [] as { lineId: string; requestId: string; phone: string; amount: number; worker: string }[], account: null, skipped: [] as string[] };
      }
      const account = await this.account(tx, con.organizationId);
      if (!account) throw new ConflictException('Set up your M-Pesa payout account (Payroll settings) before paying by M-Pesa, or mark the workers paid in cash.');
      const send: { lineId: string; requestId: string; phone: string; amount: number; worker: string }[] = [];
      const skipped: string[] = [];
      for (const l of lines) {
        const phone = mpesaPhone(l.worker.phone);
        const amount = Math.round(n(l.net));
        if (!phone || amount < 1) {
          skipped.push(l.worker.name);
          await tx.conPayrollLine.update({ where: { id: l.id }, data: { status: 'FAILED', failureReason: phone ? 'Nothing to pay' : 'No valid M-Pesa number on file' } });
          continue;
        }
        const requestId = randomUUID();
        await tx.conPayrollLine.update({ where: { id: l.id }, data: { status: 'SENDING', method: 'MPESA', requestId, failureReason: null, paidBy: con.orgUserId } });
        send.push({ lineId: l.id, requestId, phone, amount, worker: l.worker.name });
      }
      await this.audit.logInTx(tx, { action: 'con_payroll.mpesa_sent', entityType: 'ConPayrollRun', entityId: id, after: { lines: send.length, skipped, amount: send.reduce((a, s) => a + s.amount, 0) } });
      return { run: r, send, account, skipped };
    });

    for (const s of prepared.send) {
      try {
        await this.b2c.sendFrom(prepared.account!, { requestId: s.requestId, phone: s.phone, amount: s.amount, remarks: `Wages ${prepared.run.number}` });
      } catch (e) {
        await this.tenantPrisma.run((tx) => tx.conPayrollLine.update({ where: { id: s.lineId }, data: { status: 'FAILED', failureReason: (e as Error).message.slice(0, 200) } }));
      }
    }
    if (dto.method !== 'MPESA') await this.sendPayslips(con.organizationId, id);
    const view = await this.tenantPrisma.run((tx) => this.view(tx, id));
    return { ...view, skipped: prepared.skipped };
  }

  private async settleRun(tx: Tx, id: string) {
    const open = await tx.conPayrollLine.count({ where: { runId: id, status: { not: 'PAID' } } });
    if (open === 0) await tx.conPayrollRun.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
  }

  private async account(tx: Tx, organizationId: string): Promise<B2cAccount | null> {
    const s = await tx.conPayoutSettings.findUnique({ where: { organizationId } });
    if (!payoutReady(s)) return null;
    const key = this.key();
    const base = (this.config.get<string>('PUBLIC_API_BASE_URL') ?? '').replace(/\/+$/, '');
    const url = `${base}/public/construction/payroll/mpesa-b2c/${organizationId}/${s!.callbackSecret}`;
    return {
      consumerKey: decryptSecret(s!.consumerKeyEncrypted!, key), consumerSecret: decryptSecret(s!.consumerSecretEncrypted!, key), securityCredential: decryptSecret(s!.securityCredentialEncrypted!, key),
      shortcode: s!.shortcode!, initiator: s!.initiator!, environment: s!.environment, resultUrl: `${url}/result`, timeoutUrl: `${url}/timeout`, occasion: 'Wages',
    };
  }

  /** Safaricom's answer for one payment. The URL carries the business and its secret; anything else is ignored. */
  async b2cResult(organizationId: string, secret: string, body: unknown, timeout = false) {
    const parsed = parseB2cResult(body);
    const reqId = parsed.originatorConversationId ?? (body as { OriginatorConversationID?: string })?.OriginatorConversationID;
    return tenantContext.run({ organizationId, orgUserId: 'system:mpesa', role: Role.CASHIER }, async () => {
      const done = await asOrg(this.prisma, organizationId, async (tx) => {
        const s = await tx.conPayoutSettings.findUnique({ where: { organizationId } });
        if (!s || s.callbackSecret !== secret) throw new ForbiddenException();
        if (!reqId) return null;
        const line = await tx.conPayrollLine.findUnique({ where: { requestId: reqId } });
        if (!line || line.status !== 'SENDING') return null;
        const ok = !timeout && parsed.resultCode === 0;
        await tx.conPayrollLine.update({ where: { id: line.id }, data: ok ? { status: 'PAID', reference: parsed.receipt ?? null, paidAt: new Date() } : { status: 'FAILED', failureReason: timeout ? 'M-Pesa timed out' : (parsed.resultDesc ?? 'M-Pesa refused the payment').slice(0, 200) } });
        await this.audit.logInTx(tx, { action: ok ? 'con_payroll.mpesa_paid' : 'con_payroll.mpesa_failed', entityType: 'ConPayrollLine', entityId: line.id, after: { receipt: parsed.receipt ?? null, resultCode: parsed.resultCode ?? null, resultDesc: parsed.resultDesc ?? null } });
        if (ok) {
          const run = await tx.conPayrollRun.findUniqueOrThrow({ where: { id: line.runId }, select: { projectId: true } });
          await this.usage.chargePayout(tx, organizationId, line, run.projectId);
          await this.settleRun(tx, line.runId);
        }
        return ok ? line.runId : null;
      });
      if (done) await this.sendPayslips(organizationId, done);
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    });
  }

  /** Texts each worker paid in this run who has not had a payslip yet. A text that fails is simply tried with the next payment. */
  private async sendPayslips(organizationId: string, runId: string) {
    const rows = await asOrg(this.prisma, organizationId, async (tx) => {
      const run = await tx.conPayrollRun.findUniqueOrThrow({ where: { id: runId }, include: { organization: { select: { name: true } } } });
      const lines = await tx.conPayrollLine.findMany({ where: { runId, status: 'PAID', smsSentAt: null }, include: { worker: { select: { name: true, phone: true } } } });
      return lines.map((l) => ({ l, run }));
    });
    for (const { l, run } of rows) {
      const phone = mpesaPhone(l.worker.phone);
      if (!phone) continue;
      const message = payslipText({
        company: run.organization.name, worker: l.worker.name, from: day(run.periodStart)!, to: day(run.periodEnd)!, days: n(l.days), rate: n(l.dailyRate), gross: n(l.gross),
        d: { nssf: n(l.nssf), shif: n(l.shif), housingLevy: n(l.housingLevy), paye: n(l.paye), deductions: n(l.deductions), net: n(l.net) }, method: METHOD_LABEL[l.method ?? 'CASH'], reference: l.reference,
      });
      const parts = smsParts(message);
      if (!(await this.usage.takeSms(organizationId, parts))) break;
      const sent = await this.sms.sendSms({ to: `+${phone}`, message }).catch(() => ({ sent: false }));
      if (sent.sent) await asOrg(this.prisma, organizationId, (tx) => tx.conPayrollLine.update({ where: { id: l.id }, data: { smsSentAt: new Date() } }));
      else {
        await this.usage.returnSms(organizationId, parts);
        this.logger.warn(`Payslip text not sent for line ${l.id}`);
      }
    }
  }

  // ── Payout account ──

  async settings(organizationId: string) {
    const s = await this.tenantPrisma.run((tx) => tx.conPayoutSettings.findUnique({ where: { organizationId } }));
    return { ready: payoutReady(s), environment: s?.environment ?? 'production', shortcode: s?.shortcode ?? '', initiator: s?.initiator ?? '', hasKeys: !!(s?.consumerKeyEncrypted && s.consumerSecretEncrypted && s.securityCredentialEncrypted) };
  }

  async saveSettings(con: ConContext, dto: PayoutSettingsDto) {
    const key = this.key();
    const enc = (v?: string) => (v?.trim() ? encryptSecret(v.trim(), key) : undefined);
    await this.tenantPrisma.run(async (tx) => {
      const before = await tx.conPayoutSettings.findUnique({ where: { organizationId: con.organizationId } });
      const data = { environment: dto.environment, shortcode: dto.shortcode.trim(), initiator: dto.initiator.trim(), consumerKeyEncrypted: enc(dto.consumerKey), consumerSecretEncrypted: enc(dto.consumerSecret), securityCredentialEncrypted: enc(dto.securityCredential), updatedBy: con.orgUserId };
      await tx.conPayoutSettings.upsert({ where: { organizationId: con.organizationId }, create: { organizationId: con.organizationId, callbackSecret: randomBytes(24).toString('hex'), ...data }, update: data });
      await this.audit.logInTx(tx, {
        action: 'con_payout_settings.updated', entityType: 'ConPayoutSettings', entityId: con.organizationId,
        before: before && { environment: before.environment, shortcode: before.shortcode, initiator: before.initiator }, after: { environment: dto.environment, shortcode: dto.shortcode, initiator: dto.initiator, keysChanged: !!(dto.consumerKey || dto.consumerSecret || dto.securityCredential) },
      });
    });
    return this.settings(con.organizationId);
  }
}

export function payoutReady(s: { shortcode: string | null; initiator: string | null; consumerKeyEncrypted: string | null; consumerSecretEncrypted: string | null; securityCredentialEncrypted: string | null } | null) {
  return !!(s?.shortcode && s.initiator && s.consumerKeyEncrypted && s.consumerSecretEncrypted && s.securityCredentialEncrypted);
}

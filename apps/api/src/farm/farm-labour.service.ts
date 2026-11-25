import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore, tenantContext } from '../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { B2cAccount, MpesaB2cClient, parseB2cResult } from '../sales-teams/mpesa-b2c.client';
import { TAX_DEFAULTS, TAX_EFFECTIVE_FROM } from '../construction/common/con-defaults';
import { PAYROLL_KEYS, casualDeductions, mpesaPhone, payrollRates, payslipText, periodDays } from '../construction/payroll/payroll.util';
import { PayoutSettingsDto, PayrollPayDto } from '../construction/dto/payroll-portal.dto';
import { FarmContext, asOrg, hasFarmRole, isFarmOwner } from './farm-access';
import { FarmLivestockService } from './farm-livestock.service';
import { asDate, dayOf, todayKey } from './farm-livestock.util';
import { MusterDto, WageRunDto, WorkerDto } from './dto/labour.dto';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const MAX_DAYS = 31;
const DAY_VALUE = { PRESENT: 1, HALF_DAY: 0.5, ABSENT: 0 } as const;
const METHOD_LABEL = { MPESA: 'M-Pesa', MPESA_MANUAL: 'M-Pesa', CASH: 'cash' } as const;
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Zaroda Shamba F6 labour: casual workers (not users), the muster roll, and wage runs worked out from it with statutory
 * deductions from the shared settings (con_tax_settings, by effective date). Made by one person, approved by another (unless
 * nobody else can), then paid from the farm's own M-Pesa B2C account or marked paid in cash / by hand, with a payslip by SMS.
 */
@Injectable()
export class FarmLabourService {
  private readonly logger = new Logger(FarmLabourService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly b2c: MpesaB2cClient,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private key() {
    return parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
  }

  // ── Workers ─────────────────────────────────────────────────────────────

  listWorkers(farm: FarmContext, all = false) {
    return this.tenantPrisma.run(async (tx) => {
      const workers = await tx.farmWorker.findMany({ where: all ? {} : { active: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      return workers
        .filter((w) => farm.unitIds === null || !w.unitIds.length || w.unitIds.some((u) => farm.unitIds!.includes(u)))
        .map((w) => ({ ...w, dailyRate: n(w.dailyRate) }));
    });
  }

  saveWorker(dto: WorkerDto, id?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const before = id ? await tx.farmWorker.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Worker not found');
      if (dto.phone?.trim() && !mpesaPhone(dto.phone)) throw new BadRequestException('Enter an M-Pesa number like 0712 345 678');
      const data = {
        name: dto.name.trim(), phone: dto.phone?.trim() ? mpesaPhone(dto.phone) : null, idNumber: dto.idNumber?.trim() || null, dailyRate: dto.dailyRate,
        unitIds: dto.unitIds ?? before?.unitIds ?? [], notes: dto.notes?.trim() || null, active: dto.active ?? before?.active ?? true,
      };
      const w = id ? await tx.farmWorker.update({ where: { id }, data }) : await tx.farmWorker.create({ data: { organizationId, ...data } });
      await this.audit.logInTx(tx, { action: id ? 'farm.worker_updated' : 'farm.worker_added', entityType: 'FarmWorker', entityId: w.id, before: before ?? undefined, after: w });
      return { ...w, dailyRate: n(w.dailyRate) };
    });
  }

  // ── Muster roll ─────────────────────────────────────────────────────────

  muster(farm: FarmContext, day: string) {
    return this.tenantPrisma.run(async (tx) => {
      const workers = await tx.farmWorker.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
      const seen = workers.filter((w) => farm.unitIds === null || !w.unitIds.length || w.unitIds.some((u) => farm.unitIds!.includes(u)));
      const marks = await tx.farmMuster.findMany({ where: { date: asDate(day), workerId: { in: seen.map((w) => w.id) } } });
      const locked = await this.lockedWorkers(tx, day, seen.map((w) => w.id));
      return {
        date: day,
        workers: seen.map((w) => {
          const m = marks.find((x) => x.workerId === w.id);
          return { id: w.id, name: w.name, dailyRate: n(w.dailyRate), status: m?.status ?? null, task: m?.task ?? null, unitId: m?.unitId ?? null, enterpriseId: m?.enterpriseId ?? null, locked: locked.has(w.id) };
        }),
      };
    });
  }

  /** Workers whose day is already in an approved or paid run: their muster for that day is fixed. */
  private async lockedWorkers(tx: TenantTx, day: string, workerIds: string[]) {
    const runs = await tx.farmWageRun.findMany({ where: { status: { not: 'DRAFT' }, periodStart: { lte: asDate(day) }, periodEnd: { gte: asDate(day) } }, select: { id: true } });
    if (!runs.length) return new Set<string>();
    const lines = await tx.farmWageLine.findMany({ where: { runId: { in: runs.map((r) => r.id) }, workerId: { in: workerIds } }, select: { workerId: true } });
    return new Set(lines.map((l) => l.workerId));
  }

  saveMuster(farm: FarmContext, dto: MusterDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      if (dto.date > todayKey()) throw new BadRequestException('The muster cannot be marked for a day that has not come');
      const workers = await tx.farmWorker.findMany({ where: { id: { in: dto.entries.map((e) => e.workerId) } } });
      if (workers.length !== new Set(dto.entries.map((e) => e.workerId)).size) throw new BadRequestException('A worker was not found');
      for (const w of workers) {
        if (!(farm.unitIds === null || !w.unitIds.length || w.unitIds.some((u) => farm.unitIds!.includes(u)))) throw new ForbiddenException(`${w.name} works outside your part of the farm`);
      }
      for (const e of dto.entries) if (e.unitId && !FarmLivestockService.sees(farm, e.unitId)) throw new ForbiddenException('That part of the farm is outside where you work');
      const locked = await this.lockedWorkers(tx, dto.date, workers.map((w) => w.id));
      const blocked = workers.filter((w) => locked.has(w.id)).map((w) => w.name);
      if (blocked.length) throw new ConflictException(`${blocked.join(', ')}: this day is already in an approved pay run and cannot be changed.`);
      for (const e of dto.entries) {
        const data = { status: e.status, task: e.task?.trim() || null, unitId: e.unitId ?? null, enterpriseId: e.enterpriseId ?? null, recordedBy: orgUserId };
        await tx.farmMuster.upsert({ where: { workerId_date: { workerId: e.workerId, date: asDate(dto.date) } }, create: { organizationId, workerId: e.workerId, date: asDate(dto.date), ...data }, update: data });
      }
      const present = dto.entries.filter((e) => e.status !== 'ABSENT').length;
      await this.audit.logInTx(tx, { action: 'farm.muster_marked', entityType: 'FarmMuster', entityId: dto.date, after: { date: dto.date, marked: dto.entries.length, present } });
      return { date: dto.date, marked: dto.entries.length, present };
    });
  }

  // ── Wage runs ───────────────────────────────────────────────────────────

  /** Statutory rates in force on a day, from the shared settings. A farm without any yet gets the defaults Build uses. */
  private async rates(tx: TenantTx, at: string) {
    const { organizationId } = getTenantStore();
    if (!(await tx.conTaxSetting.count({ where: { key: { in: PAYROLL_KEYS } } }))) {
      await tx.conTaxSetting.createMany({
        data: TAX_DEFAULTS.filter((t) => PAYROLL_KEYS.includes(t.key)).map((t) => ({ organizationId, key: t.key, rate: t.rate, threshold: t.threshold ?? null, active: t.active ?? true, effectiveFrom: TAX_EFFECTIVE_FROM, notes: t.notes })),
        skipDuplicates: true,
      });
    }
    const rows = await tx.conTaxSetting.findMany({ where: { key: { in: PAYROLL_KEYS }, effectiveFrom: { lte: asDate(at) } }, orderBy: { effectiveFrom: 'asc' } });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) latest.set(r.key, r);
    return payrollRates(new Map([...latest.values()].filter((r) => r.active).map((r) => [r.key, { rate: n(r.rate), threshold: r.threshold === null ? null : n(r.threshold) }])));
  }

  private async view(tx: TenantTx, id: string) {
    const r = await tx.farmWageRun.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Pay run not found');
    const lines = await tx.farmWageLine.findMany({ where: { runId: id } });
    const workers = await tx.farmWorker.findMany({ where: { id: { in: lines.map((l) => l.workerId) } }, select: { id: true, name: true, phone: true } });
    return {
      ...r,
      gross: n(r.gross),
      deductions: n(r.deductions),
      net: n(r.net),
      lines: lines
        .map((l) => {
          const w = workers.find((x) => x.id === l.workerId);
          return {
            ...l, worker: w?.name ?? '', phone: w?.phone ? `${w.phone.slice(0, 6)}***${w.phone.slice(-3)}` : null, days: n(l.days), dailyRate: n(l.dailyRate), gross: n(l.gross), nssf: n(l.nssf),
            shif: n(l.shif), housingLevy: n(l.housingLevy), paye: n(l.paye), deductions: n(l.deductions), net: n(l.net),
          };
        })
        .sort((a, b) => a.worker.localeCompare(b.worker)),
    };
  }

  listRuns() {
    return this.tenantPrisma.run(async (tx) => {
      const runs = await tx.farmWageRun.findMany({ orderBy: { periodStart: 'desc' }, take: 60 });
      return runs.map((r) => ({ ...r, gross: n(r.gross), deductions: n(r.deductions), net: n(r.net) }));
    });
  }

  getRun(id: string) {
    return this.tenantPrisma.run((tx) => this.view(tx, id));
  }

  createRun(dto: WageRunDto) {
    if (dto.periodEnd < dto.periodStart) throw new BadRequestException('The period ends before it starts');
    if (dto.periodEnd > todayKey()) throw new BadRequestException('A pay run cannot include days that have not happened yet');
    const days = periodDays(dto.periodStart, dto.periodEnd);
    if (days > MAX_DAYS) throw new BadRequestException(`A pay run covers at most ${MAX_DAYS} days`);
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const clash = await tx.farmWageRun.findFirst({ where: { periodStart: { lte: asDate(dto.periodEnd) }, periodEnd: { gte: asDate(dto.periodStart) } } });
      if (clash) throw new ConflictException(`${clash.number} already covers some of these days (${dayOf(clash.periodStart)} to ${dayOf(clash.periodEnd)})`);
      const muster = await tx.farmMuster.findMany({ where: { date: { gte: asDate(dto.periodStart), lte: asDate(dto.periodEnd) }, status: { not: 'ABSENT' } } });
      const workers = await tx.farmWorker.findMany({ where: { id: { in: [...new Set(muster.map((m) => m.workerId))] } } });
      const byWorker = new Map<string, number>();
      for (const m of muster) byWorker.set(m.workerId, (byWorker.get(m.workerId) ?? 0) + DAY_VALUE[m.status]);
      if (!byWorker.size) throw new BadRequestException('Nobody is marked present on the muster roll for these days');
      const rates = await this.rates(tx, dto.periodEnd);
      const lines = [...byWorker.entries()].map(([workerId, d]) => {
        const rate = n(workers.find((w) => w.id === workerId)?.dailyRate);
        const gross = r2(d * rate);
        return { workerId, days: d, dailyRate: rate, gross, ...casualDeductions(gross, days, rates) };
      });
      const sum = (k: 'gross' | 'deductions' | 'net') => r2(lines.reduce((a, l) => a + l[k], 0));
      const count = await tx.farmWageRun.count();
      const run = await tx.farmWageRun.create({
        data: {
          organizationId, number: `WAGE-${String(count + 1).padStart(3, '0')}`, periodStart: asDate(dto.periodStart), periodEnd: asDate(dto.periodEnd), notes: dto.notes?.trim() || null,
          createdBy: orgUserId, workers: lines.length, gross: sum('gross'), deductions: sum('deductions'), net: sum('net'),
        },
      });
      await tx.farmWageLine.createMany({
        data: lines.map((l) => ({
          organizationId, runId: run.id, workerId: l.workerId, days: l.days, dailyRate: l.dailyRate, gross: l.gross, nssf: l.nssf, shif: l.shif, housingLevy: l.housingLevy, paye: l.paye,
          deductions: l.deductions, net: l.net,
        })),
      });
      await this.audit.logInTx(tx, { action: 'farm.wage_run_created', entityType: 'FarmWageRun', entityId: run.id, after: { number: run.number, periodStart: dto.periodStart, periodEnd: dto.periodEnd, workers: lines.length, gross: sum('gross'), net: sum('net') } });
      return this.view(tx, run.id);
    });
  }

  removeRun(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await tx.farmWageRun.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Pay run not found');
      if (r.status !== 'DRAFT') throw new ConflictException('Only a draft pay run can be deleted');
      await tx.farmWageLine.deleteMany({ where: { runId: id } });
      await tx.farmWageRun.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'farm.wage_run_deleted', entityType: 'FarmWageRun', entityId: id, before: { number: r.number, net: n(r.net) } });
      return { ok: true };
    });
  }

  /** Someone other than the preparer approves; a farm with nobody else who can approve lets the owner approve their own. */
  approveRun(farm: FarmContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await tx.farmWageRun.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Pay run not found');
      if (r.status !== 'DRAFT') throw new ConflictException(`${r.number} is already ${r.status.toLowerCase()}`);
      if (r.createdBy === farm.orgUserId) {
        const others = await tx.orgUser.count({ where: { id: { not: farm.orgUserId }, isActive: true, role: Role.OWNER } });
        const managers = await tx.farmUserRole.count({ where: { orgUserId: { not: farm.orgUserId }, role: { in: ['FARM_MANAGER', 'FARM_OWNER'] } } });
        if (others + managers > 0 || !isFarmOwner(farm)) throw new ForbiddenException('You prepared this pay run, so someone else must approve it');
      }
      await tx.farmWageRun.update({ where: { id }, data: { status: 'APPROVED', approvedBy: farm.orgUserId, approvedAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'farm.wage_run_approved', entityType: 'FarmWageRun', entityId: id, before: { status: r.status }, after: { status: 'APPROVED', net: n(r.net) } });
      return this.view(tx, id);
    });
  }

  /** Cash or a hand-made M-Pesa payment is settled at once; M-Pesa B2C is sent now and settled when Safaricom answers. */
  async payRun(farm: FarmContext, id: string, dto: PayrollPayDto) {
    if (!hasFarmRole(farm, ['FARM_MANAGER'])) throw new ForbiddenException('Only a farm manager pays wages');
    if (dto.method === 'MPESA_MANUAL' && !dto.reference?.trim()) throw new BadRequestException('Enter the M-Pesa code of the payment');
    const prepared = await this.tenantPrisma.run(async (tx) => {
      const r = await tx.farmWageRun.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Pay run not found');
      if (r.status === 'DRAFT') throw new ConflictException('Approve the pay run before paying it');
      if (r.status === 'PAID') throw new ConflictException(`${r.number} is already paid`);
      const lines = await tx.farmWageLine.findMany({ where: { runId: id, status: { in: ['UNPAID', 'FAILED'] }, ...(dto.lineIds ? { id: { in: dto.lineIds } } : {}) } });
      if (!lines.length) throw new ConflictException('Nobody selected is waiting to be paid');
      const workers = await tx.farmWorker.findMany({ where: { id: { in: lines.map((l) => l.workerId) } } });
      if (dto.method !== 'MPESA') {
        for (const l of lines) {
          await tx.farmWageLine.update({ where: { id: l.id }, data: { status: 'PAID', method: dto.method, reference: dto.reference?.trim() || null, paidAt: new Date(), paidBy: farm.orgUserId, failureReason: null } });
        }
        await this.audit.logInTx(tx, { action: 'farm.wages_paid', entityType: 'FarmWageRun', entityId: id, after: { method: dto.method, reference: dto.reference ?? null, lines: lines.length, amount: r2(lines.reduce((a, l) => a + n(l.net), 0)) } });
        await this.settleRun(tx, id);
        return { run: r, send: [] as { lineId: string; requestId: string; phone: string; amount: number }[], account: null as B2cAccount | null, skipped: [] as string[] };
      }
      const account = await this.account(tx, farm.organizationId);
      if (!account) throw new ConflictException('Set up the farm M-Pesa payout account (Workers > Payout account) before paying by M-Pesa, or mark the workers paid in cash.');
      const send: { lineId: string; requestId: string; phone: string; amount: number }[] = [];
      const skipped: string[] = [];
      for (const l of lines) {
        const w = workers.find((x) => x.id === l.workerId);
        const phone = mpesaPhone(w?.phone ?? null);
        const amount = Math.round(n(l.net));
        if (!phone || amount < 1) {
          skipped.push(w?.name ?? '');
          await tx.farmWageLine.update({ where: { id: l.id }, data: { status: 'FAILED', failureReason: phone ? 'Nothing to pay' : 'No valid M-Pesa number on file' } });
          continue;
        }
        const requestId = randomUUID();
        await tx.farmWageLine.update({ where: { id: l.id }, data: { status: 'SENDING', method: 'MPESA', requestId, failureReason: null, paidBy: farm.orgUserId } });
        send.push({ lineId: l.id, requestId, phone, amount });
      }
      await this.audit.logInTx(tx, { action: 'farm.wages_mpesa_sent', entityType: 'FarmWageRun', entityId: id, after: { lines: send.length, skipped, amount: send.reduce((a, s) => a + s.amount, 0) } });
      return { run: r, send, account, skipped };
    });

    for (const s of prepared.send) {
      try {
        await this.b2c.sendFrom(prepared.account!, { requestId: s.requestId, phone: s.phone, amount: s.amount, remarks: `Wages ${prepared.run.number}` });
      } catch (e) {
        await this.tenantPrisma.run((tx) => tx.farmWageLine.update({ where: { id: s.lineId }, data: { status: 'FAILED', failureReason: (e as Error).message.slice(0, 200) } }));
      }
    }
    if (dto.method !== 'MPESA') await this.sendPayslips(farm.organizationId, id);
    const view = await this.tenantPrisma.run((tx) => this.view(tx, id));
    return { ...view, skipped: prepared.skipped };
  }

  private async settleRun(tx: TenantTx, id: string) {
    const open = await tx.farmWageLine.count({ where: { runId: id, status: { not: 'PAID' } } });
    if (open === 0) await tx.farmWageRun.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
  }

  private async account(tx: TenantTx, organizationId: string): Promise<B2cAccount | null> {
    const s = await tx.farmPayoutSettings.findUnique({ where: { organizationId } });
    if (!s?.shortcode || !s.initiator || !s.consumerKeyEncrypted || !s.consumerSecretEncrypted || !s.securityCredentialEncrypted) return null;
    const key = this.key();
    const base = (this.config.get<string>('PUBLIC_API_BASE_URL') ?? '').replace(/\/+$/, '');
    const url = `${base}/public/farm/wages/mpesa-b2c/${organizationId}/${s.callbackSecret}`;
    return {
      consumerKey: decryptSecret(s.consumerKeyEncrypted, key), consumerSecret: decryptSecret(s.consumerSecretEncrypted, key), securityCredential: decryptSecret(s.securityCredentialEncrypted, key),
      shortcode: s.shortcode, initiator: s.initiator, environment: s.environment as 'sandbox' | 'production', resultUrl: `${url}/result`, timeoutUrl: `${url}/timeout`, occasion: 'Wages',
    };
  }

  /** Safaricom's answer for one payment. The URL carries the farm and its secret; anything else is ignored. */
  async b2cResult(organizationId: string, secret: string, body: unknown, timeout = false) {
    const parsed = parseB2cResult(body);
    const reqId = parsed.originatorConversationId ?? (body as { OriginatorConversationID?: string })?.OriginatorConversationID;
    return tenantContext.run({ organizationId, orgUserId: 'system:mpesa', role: Role.CASHIER }, async () => {
      const done = await asOrg(this.prisma, organizationId, async (tx) => {
        const s = await tx.farmPayoutSettings.findUnique({ where: { organizationId } });
        if (!s || !safeEqual(s.callbackSecret, secret)) throw new ForbiddenException();
        if (!reqId) return null;
        const line = await tx.farmWageLine.findUnique({ where: { requestId: reqId } });
        if (!line || line.status !== 'SENDING') return null;
        const ok = !timeout && parsed.resultCode === 0;
        await tx.farmWageLine.update({
          where: { id: line.id },
          data: ok ? { status: 'PAID', reference: parsed.receipt ?? null, paidAt: new Date() } : { status: 'FAILED', failureReason: timeout ? 'M-Pesa timed out' : (parsed.resultDesc ?? 'M-Pesa refused the payment').slice(0, 200) },
        });
        await this.audit.logInTx(tx, { action: ok ? 'farm.wages_mpesa_paid' : 'farm.wages_mpesa_failed', entityType: 'FarmWageLine', entityId: line.id, after: { receipt: parsed.receipt ?? null, resultCode: parsed.resultCode ?? null } });
        if (ok) await this.settleRun(tx, line.runId);
        return ok ? line.runId : null;
      });
      if (done) await this.sendPayslips(organizationId, done);
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    });
  }

  /** Texts each worker paid in this run who has not had a payslip yet (when SMS is set up). */
  private async sendPayslips(organizationId: string, runId: string) {
    const rows = await asOrg(this.prisma, organizationId, async (tx) => {
      const run = await tx.farmWageRun.findUniqueOrThrow({ where: { id: runId } });
      const farmName = (await tx.farmSettings.findFirst({ select: { farmName: true } }))?.farmName ?? 'Your farm';
      const lines = await tx.farmWageLine.findMany({ where: { runId, status: 'PAID', smsSentAt: null } });
      const workers = await tx.farmWorker.findMany({ where: { id: { in: lines.map((l) => l.workerId) } } });
      return lines.map((l) => ({ l, run, farmName, w: workers.find((x) => x.id === l.workerId) }));
    });
    for (const { l, run, farmName, w } of rows) {
      const phone = mpesaPhone(w?.phone ?? null);
      if (!phone || !w) continue;
      const message = payslipText({
        company: farmName, worker: w.name, from: dayOf(run.periodStart), to: dayOf(run.periodEnd), days: n(l.days), rate: n(l.dailyRate), gross: n(l.gross),
        d: { nssf: n(l.nssf), shif: n(l.shif), housingLevy: n(l.housingLevy), paye: n(l.paye), deductions: n(l.deductions), net: n(l.net) }, method: METHOD_LABEL[l.method ?? 'CASH'], reference: l.reference,
      });
      const sent = await this.sms.sendSms({ to: `+${phone}`, message }).catch(() => ({ sent: false }));
      if (sent.sent) await asOrg(this.prisma, organizationId, (tx) => tx.farmWageLine.update({ where: { id: l.id }, data: { smsSentAt: new Date() } }));
      else this.logger.warn(`Payslip text not sent for farm wage line ${l.id}`);
    }
  }

  // ── Payout account ──────────────────────────────────────────────────────

  async payoutSettings() {
    const s = await this.tenantPrisma.run((tx) => tx.farmPayoutSettings.findFirst());
    const ready = !!(s?.shortcode && s.initiator && s.consumerKeyEncrypted && s.consumerSecretEncrypted && s.securityCredentialEncrypted);
    return { ready, environment: s?.environment ?? 'production', shortcode: s?.shortcode ?? '', initiator: s?.initiator ?? '', hasKeys: !!(s?.consumerKeyEncrypted && s.consumerSecretEncrypted && s.securityCredentialEncrypted) };
  }

  async savePayoutSettings(dto: PayoutSettingsDto) {
    const key = this.key();
    const enc = (v?: string) => (v?.trim() ? encryptSecret(v.trim(), key) : undefined);
    await this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const before = await tx.farmPayoutSettings.findUnique({ where: { organizationId } });
      const data = {
        environment: dto.environment, shortcode: dto.shortcode.trim(), initiator: dto.initiator.trim(), consumerKeyEncrypted: enc(dto.consumerKey), consumerSecretEncrypted: enc(dto.consumerSecret),
        securityCredentialEncrypted: enc(dto.securityCredential), updatedBy: orgUserId,
      };
      await tx.farmPayoutSettings.upsert({ where: { organizationId }, create: { organizationId, callbackSecret: randomBytes(24).toString('hex'), ...data }, update: data });
      await this.audit.logInTx(tx, {
        action: 'farm.payout_settings_updated', entityType: 'FarmPayoutSettings', entityId: organizationId,
        before: before ? { environment: before.environment, shortcode: before.shortcode, initiator: before.initiator } : undefined,
        after: { environment: dto.environment, shortcode: dto.shortcode, initiator: dto.initiator, keysChanged: !!(dto.consumerKey || dto.consumerSecret || dto.securityCredential) },
      });
    });
    return this.payoutSettings();
  }
}

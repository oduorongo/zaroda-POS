import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { tenantContext } from '../../common/tenant/tenant-context';
import { paymentsReady } from '../../online-store/payment-gateway';
import { RentalBillingService } from '../rental-billing.service';
import { fromCents, invoiceStatus, nairobiToday, toCents } from '../rental-billing.util';
import { loadPlan } from '../rental-plans.service';
import { planHas } from '../rental-plans.util';
import { RentalMpesaService } from '../rental-mpesa.service';
import { PortalMaintenanceDto, PortalPayDto } from './dto/tenant-portal.dto';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
// A tenant cannot bury a landlord in requests.
const MAX_OPEN_REQUESTS = 5;

interface TenantRecord {
  id: string;
  organizationId: string;
  name: string;
}

/**
 * What a signed-in tenant may see and do. The tenant's token proves only their email address, so every call starts by
 * finding the tenant records that carry that address (across landlords, through the narrow email-only access rule);
 * after that all work happens inside the owning landlord's own context, and every lease, payment and request is
 * checked to belong to one of those records before anything is read or changed. A tenant can therefore never reach
 * another tenant's rows by guessing an id - it simply is not found.
 */
@Injectable()
export class RentalTenantPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: RentalBillingService,
    private readonly mpesa: RentalMpesaService,
  ) {}

  private runAsEmail<T>(email: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_email', ${email}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  private runAsOrg<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Runs existing landlord-side code (statements, receipts, M-Pesa prompts) as the owning landlord's business. */
  private asOrg<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ organizationId, orgUserId: 'tenant-portal', role: Role.CASHIER }, fn);
  }

  /** The tenant's records, leaving out landlords whose plan has no tenant portal (Bure). */
  private async records(email: string): Promise<TenantRecord[]> {
    const all = await this.runAsEmail(email, (tx) =>
      tx.rentalTenant.findMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, organizationId: true, name: true },
      }),
    );
    const withPortal = new Map<string, boolean>();
    for (const organizationId of new Set(all.map((r) => r.organizationId))) {
      withPortal.set(organizationId, planHas(await this.runAsOrg(organizationId, (tx) => loadPlan(tx, organizationId)), 'portal'));
    }
    return all.filter((r) => withPortal.get(r.organizationId));
  }

  /** The records grouped by landlord, so one pass per business. */
  private byOrg(records: TenantRecord[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const r of records) map.set(r.organizationId, [...(map.get(r.organizationId) ?? []), r.id]);
    return map;
  }

  // ── Everything for the home screen ──────────────────────────────────────

  async me(email: string) {
    const records = await this.records(email);
    const today = nairobiToday();
    const tenancies = [];

    for (const [organizationId, tenantIds] of this.byOrg(records)) {
      const view = await this.runAsOrg(organizationId, async (tx) => {
        const [org, settings, plan, leases, maintenance] = await Promise.all([
          tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
          tx.rentalSettings.findUnique({ where: { organizationId } }),
          loadPlan(tx, organizationId),
          tx.rentalLease.findMany({
            where: { tenantId: { in: tenantIds } },
            orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
            include: {
              unit: { select: { label: true, property: { select: { name: true, address: true } } } },
              invoices: true,
              payments: { where: { voidedAt: null }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], include: { allocations: { select: { amount: true } } } },
              requests: { where: { status: 'PENDING', createdAt: { gt: new Date(Date.now() - 10 * 60_000) } }, select: { id: true, amount: true, createdAt: true } },
            },
          }),
          tx.rentalMaintenanceRequest.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { createdAt: 'desc' }, take: 20 }),
        ]);

        // Bring invoices up to date first, so what the tenant sees matches what the landlord sees.
        for (const lease of leases) {
          if (lease.status === 'ACTIVE') await this.billing.syncLease(tx, organizationId, lease, today);
        }
        const fresh = await tx.rentalInvoice.findMany({ where: { leaseId: { in: leases.map((l) => l.id) } } });

        return {
          business: org?.name ?? '',
          canPayByMpesa: settings ? paymentsReady(settings) && planHas(plan, 'collect') : false,
          paymentInstructions: settings?.paymentInstructions ?? null,
          leases: leases.map((l) => {
            const invoices = fresh.filter((i) => i.leaseId === l.id);
            let outstanding = 0;
            let overdue = 0;
            let nextDue: Date | null = null;
            for (const inv of invoices) {
              const owed = toCents(inv.amountDue) - toCents(inv.amountPaid);
              if (owed <= 0) continue;
              outstanding += owed;
              if (inv.dueDate < today) overdue += owed;
              else if (!nextDue || inv.dueDate < nextDue) nextDue = inv.dueDate;
            }
            const credit = l.payments.reduce((s, p) => s + toCents(p.amount) - p.allocations.reduce((t, a) => t + toCents(a.amount), 0), 0);
            return {
              leaseId: l.id,
              status: l.status,
              startDate: l.startDate,
              endedAt: l.endedAt,
              property: l.unit.property,
              unit: l.unit.label,
              monthlyRent: Number(l.monthlyRent),
              dueDay: l.dueDay,
              outstanding: fromCents(outstanding),
              overdue: fromCents(overdue),
              credit: fromCents(credit),
              nextDue,
              openInvoices: invoices
                .filter((i) => toCents(i.amountDue) - toCents(i.amountPaid) > 0)
                .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
                .map((i) => ({
                  id: i.id,
                  description: i.description ?? i.kind,
                  dueDate: i.dueDate,
                  balance: fromCents(toCents(i.amountDue) - toCents(i.amountPaid)),
                  status: invoiceStatus(i.amountDue, i.amountPaid, i.dueDate, today),
                })),
              payments: l.payments.slice(0, 12).map((p) => ({
                id: p.id,
                receiptNumber: p.receiptNumber,
                amount: Number(p.amount),
                method: p.method,
                paidAt: p.paidAt,
              })),
              pendingPrompt: l.requests[0] ? { id: l.requests[0].id, amount: Number(l.requests[0].amount) } : null,
            };
          }),
          maintenance: maintenance.map((m) => ({
            id: m.id,
            title: m.title,
            status: m.status,
            priority: m.priority,
            reportedAt: m.reportedAt,
            resolvedAt: m.resolvedAt,
          })),
        };
      });
      tenancies.push({ tenantName: records.find((r) => r.organizationId === organizationId)?.name ?? '', ...view });
    }
    return { email, tenancies };
  }

  // ── Ownership checks ────────────────────────────────────────────────────

  /** The landlord and tenant record this lease belongs to - or "not found" if it is not this tenant's. */
  private async ownLease(email: string, leaseId: string) {
    const records = await this.records(email);
    for (const [organizationId, tenantIds] of this.byOrg(records)) {
      const lease = await this.runAsOrg(organizationId, (tx) =>
        tx.rentalLease.findFirst({
          where: { id: leaseId, tenantId: { in: tenantIds } },
          include: { unit: { select: { propertyId: true, label: true } }, invoices: true },
        }),
      );
      if (lease) return { organizationId, lease };
    }
    throw new NotFoundException('Lease not found');
  }

  private async ownPayment(email: string, paymentId: string): Promise<string> {
    const records = await this.records(email);
    for (const [organizationId, tenantIds] of this.byOrg(records)) {
      const found = await this.runAsOrg(organizationId, (tx) =>
        tx.rentalPayment.findFirst({ where: { id: paymentId, lease: { tenantId: { in: tenantIds } } }, select: { id: true } }),
      );
      if (found) return organizationId;
    }
    throw new NotFoundException('Receipt not found');
  }

  // ── Documents ───────────────────────────────────────────────────────────

  async statement(email: string, leaseId: string) {
    const { organizationId } = await this.ownLease(email, leaseId);
    return this.asOrg(organizationId, () => this.billing.statement(leaseId));
  }

  async receipt(email: string, paymentId: string) {
    const organizationId = await this.ownPayment(email, paymentId);
    return this.asOrg(organizationId, () => this.billing.getReceipt(paymentId));
  }

  // ── Paying ──────────────────────────────────────────────────────────────

  /** Sends an M-Pesa prompt to the tenant's phone for part or all of what they owe. */
  async pay(email: string, dto: PortalPayDto) {
    const { organizationId, lease } = await this.ownLease(email, dto.leaseId);
    if (lease.status !== 'ACTIVE') throw new BadRequestException('This tenancy has ended - please contact your landlord about any balance');
    const owed = lease.invoices.reduce((s, i) => s + Math.max(toCents(i.amountDue) - toCents(i.amountPaid), 0), 0);
    if (owed <= 0) throw new BadRequestException('You do not owe anything right now');
    if (toCents(dto.amount) > owed) throw new BadRequestException(`You owe KES ${fromCents(owed)} - enter that amount or less`);
    return this.asOrg(organizationId, () => this.mpesa.requestPayment({ leaseId: dto.leaseId, amount: dto.amount, phone: dto.phone }));
  }

  /** Whether a prompt the tenant sent has been paid yet (the page polls this). */
  async promptStatus(email: string, requestId: string) {
    const records = await this.records(email);
    for (const [organizationId, tenantIds] of this.byOrg(records)) {
      const request = await this.runAsOrg(organizationId, (tx) =>
        tx.rentalPaymentRequest.findFirst({
          where: { id: requestId, lease: { tenantId: { in: tenantIds } } },
          select: { id: true, status: true, amount: true, mpesaReceipt: true, lastError: true, paymentId: true },
        }),
      );
      if (request) return { id: request.id, status: request.status, amount: Number(request.amount), mpesaReceipt: request.mpesaReceipt, lastError: request.lastError, paymentId: request.paymentId };
    }
    throw new NotFoundException('Request not found');
  }

  // ── Telling the landlord about a problem ────────────────────────────────

  async reportProblem(email: string, dto: PortalMaintenanceDto) {
    const { organizationId, lease } = await this.ownLease(email, dto.leaseId);
    return this.runAsOrg(organizationId, async (tx) => {
      const open = await tx.rentalMaintenanceRequest.count({ where: { tenantId: lease.tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
      if (open >= MAX_OPEN_REQUESTS) {
        throw new BadRequestException('You already have several open requests - your landlord will get to them, or call them about anything urgent');
      }
      const request = await tx.rentalMaintenanceRequest.create({
        data: {
          organizationId,
          propertyId: lease.unit.propertyId,
          unitId: lease.unitId,
          tenantId: lease.tenantId,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          reportedAt: nairobiToday(),
        },
      });
      return { id: request.id, title: request.title, status: request.status };
    });
  }
}

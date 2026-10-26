import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SchoolOrderStatus,
  SupplierInvoiceStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  CashflowItemDto,
  CashflowQueryDto,
  CashflowSettingsDto,
} from './dto/school-supplier.dto';
import {
  buildForecast,
  FlowLine,
  horizonEnd,
  occurrences,
  receiptDate,
  scaled,
  scenarioProblem,
} from './school-cashflow.util';
import { addDays, daysBetween, fromCents, toCents, todayKey } from './school-money.util';
import { invoicePosition } from './school-retention.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const OPEN = [SupplierInvoiceStatus.ISSUED, SupplierInvoiceStatus.PARTIALLY_PAID];
/** How long after the order is confirmed the goods are assumed to go out, when working out the money still to come from orders. */
const DELIVERY_ASSUMED_DAYS = 7;

export interface NotCounted {
  source: string;
  ref: string;
  label: string;
  amount: number;
  reason: string;
}

const itemView = (i: Prisma.SchoolCashflowItemGetPayload<object>) => ({
  id: i.id,
  direction: i.direction,
  description: i.description,
  amount: Number(i.amount),
  date: day(i.date)!,
  repeat: i.repeat,
  repeatUntil: day(i.repeatUntil),
  notes: i.notes,
  active: i.active,
});

/**
 * The 13-week cash-flow forecast. It starts from the cash on hand (entered by hand: the system does not see the bank) and adds,
 * week by week, the money expected from schools (open invoices, retention being released, optionally orders still to deliver) and
 * takes off the supplier bills coming due and the planned items (salaries, rent, loan repayments). Every figure is a line that can
 * be followed back to its invoice, bill or item, and what was left out is listed with the reason. The scenario (how much of it
 * schools really pay, and how many days late) is chosen when you look at it and is not stored.
 */
@Injectable()
export class SchoolCashflowService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async forecast(q: CashflowQueryDto) {
    const scenario = { collectPercent: q.collectPercent ?? 100, delayDays: q.delayDays ?? 0 };
    const problem = scenarioProblem(scenario);
    if (problem) throw new BadRequestException(problem);
    const includeRetention = q.includeRetention !== 'false';
    const includeBills = q.includeBills !== 'false';
    const includePipeline = q.includePipeline === 'true';
    const includeDisputed = q.includeDisputed === 'true';
    const today = todayKey();
    const end = horizonEnd(today);

    const data = await this.tenantPrisma.run(async (tx) => {
      const [settings, invoices, bills, items, orders] = await Promise.all([
        tx.schoolCashflowSettings.findFirst(),
        tx.supplierInvoice.findMany({
          where: { status: { in: OPEN } },
          select: {
            id: true,
            invoiceNumber: true,
            dueDate: true,
            expectedPaymentDate: true,
            disputed: true,
            total: true,
            amountPaid: true,
            creditAmount: true,
            writtenOffAmount: true,
            retentionHeld: true,
            retentionReleaseDate: true,
            retentionDisputed: true,
            school: { select: { name: true, creditDays: true } },
          },
          take: 2000,
        }),
        includeBills
          ? tx.supplierBill.findMany({
              where: { status: { in: ['OPEN', 'PARTLY_PAID'] } },
              select: {
                id: true,
                billNumber: true,
                dueDate: true,
                total: true,
                amountPaid: true,
                creditAmount: true,
                supplier: { select: { name: true } },
              },
              take: 2000,
            })
          : Promise.resolve([]),
        tx.schoolCashflowItem.findMany({ orderBy: [{ active: 'desc' }, { date: 'asc' }], take: 500 }),
        includePipeline
          ? tx.schoolOrder.findMany({
              where: { status: { in: [SchoolOrderStatus.CONFIRMED, SchoolOrderStatus.PARTIALLY_DELIVERED] } },
              select: {
                id: true,
                orderNumber: true,
                school: { select: { name: true, creditDays: true } },
                lines: {
                  select: {
                    unitPrice: true,
                    taxRate: true,
                    quantityOrdered: true,
                    quantityConfirmed: true,
                    quantityDelivered: true,
                  },
                },
              },
              take: 1000,
            })
          : Promise.resolve([]),
      ]);
      return { settings, invoices, bills, items, orders };
    });

    const inflows: FlowLine[] = [];
    const outflows: FlowLine[] = [];
    const notCounted: NotCounted[] = [];

    for (const inv of data.invoices) {
      const pos = invoicePosition({
        total: Number(inv.total),
        paid: Number(inv.amountPaid),
        credited: Number(inv.creditAmount),
        writtenOff: Number(inv.writtenOffAmount),
        retentionHeld: Number(inv.retentionHeld),
      });
      const due = day(inv.dueDate)!;
      const promised = day(inv.expectedPaymentDate);
      if (pos.dueNow > 0) {
        if (inv.disputed && !includeDisputed) {
          notCounted.push({ source: 'INVOICE', ref: inv.invoiceNumber, label: `${inv.school.name} - ${inv.invoiceNumber}`, amount: pos.dueNow, reason: 'Disputed by the school' });
        } else {
          // a promise to pay still ahead is believed; one already broken is not, so it is counted as due
          const expected = promised && promised >= today ? promised : due;
          inflows.push({
            source: 'INVOICE',
            ref: inv.invoiceNumber,
            label: `${inv.school.name} - ${inv.invoiceNumber}`,
            amount: scaled(pos.dueNow, scenario.collectPercent),
            date: receiptDate(expected, today, scenario.delayDays),
            note: promised && promised >= today ? `promised for ${promised}` : due < today ? `${daysBetween(due, today)} days overdue` : `due ${due}`,
          });
        }
      }
      if (includeRetention && pos.retention > 0) {
        const release = day(inv.retentionReleaseDate);
        if (inv.retentionDisputed) {
          notCounted.push({ source: 'RETENTION', ref: inv.invoiceNumber, label: `${inv.school.name} - ${inv.invoiceNumber}`, amount: pos.retention, reason: 'Retention disputed' });
        } else if (!release) {
          notCounted.push({ source: 'RETENTION', ref: inv.invoiceNumber, label: `${inv.school.name} - ${inv.invoiceNumber}`, amount: pos.retention, reason: 'No release date set' });
        } else {
          // released on that day, then paid within the school's usual days
          inflows.push({
            source: 'RETENTION',
            ref: inv.invoiceNumber,
            label: `${inv.school.name} - retention on ${inv.invoiceNumber}`,
            amount: scaled(pos.retention, scenario.collectPercent),
            date: receiptDate(addDays(release < today ? today : release, inv.school.creditDays), today, scenario.delayDays),
            note: `released ${release}`,
          });
        }
      }
    }

    for (const o of data.orders) {
      let remaining = 0;
      for (const l of o.lines) {
        const agreed = Number(l.quantityConfirmed ?? l.quantityOrdered);
        const left = Math.max(0, agreed - Number(l.quantityDelivered ?? 0));
        remaining += toCents(left * Number(l.unitPrice) * (1 + Number(l.taxRate)));
      }
      if (remaining <= 0) continue;
      inflows.push({
        source: 'ORDER',
        ref: o.orderNumber,
        label: `${o.school.name} - order ${o.orderNumber} still to deliver`,
        amount: scaled(fromCents(remaining), scenario.collectPercent),
        date: receiptDate(addDays(today, DELIVERY_ASSUMED_DAYS + o.school.creditDays), today, scenario.delayDays),
        note: `goods assumed out in ${DELIVERY_ASSUMED_DAYS} days`,
      });
    }

    for (const b of data.bills) {
      const owed = fromCents(toCents(b.total) - toCents(b.creditAmount) - toCents(b.amountPaid));
      if (owed <= 0) continue;
      const due = day(b.dueDate)!;
      outflows.push({
        source: 'BILL',
        ref: b.billNumber,
        label: `${b.supplier.name} - ${b.billNumber}`,
        amount: owed,
        date: due < today ? today : due,
        note: due < today ? `${daysBetween(due, today)} days overdue` : `due ${due}`,
      });
    }

    for (const i of data.items) {
      if (!i.active) continue;
      for (const d of occurrences({ date: day(i.date)!, repeat: i.repeat, repeatUntil: day(i.repeatUntil) }, today, end)) {
        (i.direction === 'IN' ? inflows : outflows).push({
          source: 'PLANNED',
          ref: i.id,
          label: i.description,
          amount: Number(i.amount),
          date: d,
          note: i.repeat === 'NONE' ? null : i.repeat === 'WEEKLY' ? 'every week' : 'every month',
        });
      }
    }

    const opening = data.settings ? Number(data.settings.openingCash) : 0;
    const minimum = data.settings ? Number(data.settings.minimumCash) : 0;
    const asOf = day(data.settings?.openingCashAsOf ?? null);
    const warnings: string[] = [];
    if (!asOf) warnings.push('Enter the cash you have now, otherwise the forecast starts from nothing.');
    else if (daysBetween(asOf, today) > 7) warnings.push(`The cash on hand was last entered ${daysBetween(asOf, today)} days ago. Update it.`);
    if (data.invoices.length >= 2000) warnings.push('Only the first 2000 open invoices were counted.');

    return {
      today,
      settings: { openingCash: opening, openingCashAsOf: asOf, minimumCash: minimum },
      scenario: { ...scenario, includeRetention, includePipeline, includeBills, includeDisputed },
      forecast: buildForecast({ today, opening, minimum, inflows, outflows }),
      notCounted,
      planned: data.items.map(itemView),
      warnings,
    };
  }

  async updateSettings(dto: CashflowSettingsDto) {
    const { organizationId } = getTenantStore();
    await this.tenantPrisma.run(async (tx) => {
      const data = {
        openingCash: dto.openingCash,
        minimumCash: dto.minimumCash,
        openingCashAsOf: new Date(`${todayKey()}T00:00:00Z`),
      };
      await tx.schoolCashflowSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
      await this.audit.logInTx(tx, {
        action: 'school.cashflow_settings',
        entityType: 'SchoolCashflowSettings',
        entityId: organizationId,
        after: { openingCash: dto.openingCash, minimumCash: dto.minimumCash },
      });
    });
    return this.forecast({});
  }

  private check(dto: CashflowItemDto) {
    const repeat = dto.repeat ?? 'NONE';
    if (dto.repeatUntil && repeat === 'NONE')
      throw new BadRequestException('A stop date only goes with an item that repeats.');
    if (dto.repeatUntil && dto.repeatUntil < dto.date)
      throw new BadRequestException('It cannot stop before it starts.');
    return repeat;
  }

  async addItem(dto: CashflowItemDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const repeat = this.check(dto);
    return this.tenantPrisma.run(async (tx) => {
      const u = await tx.orgUser.findUnique({
        where: { id: orgUserId },
        select: { user: { select: { fullName: true } } },
      });
      const row = await tx.schoolCashflowItem.create({
        data: {
          organizationId,
          direction: dto.direction,
          description: dto.description.trim(),
          amount: dto.amount,
          date: new Date(`${dto.date}T00:00:00Z`),
          repeat,
          repeatUntil: dto.repeatUntil ? new Date(`${dto.repeatUntil}T00:00:00Z`) : null,
          notes: dto.notes?.trim() || null,
          active: dto.active ?? true,
          createdByName: u?.user.fullName ?? null,
        },
      });
      return itemView(row);
    });
  }

  async updateItem(id: string, dto: CashflowItemDto) {
    const repeat = this.check(dto);
    return this.tenantPrisma.run(async (tx) => {
      const found = await tx.schoolCashflowItem.findUnique({ where: { id } });
      if (!found) throw new NotFoundException('Item not found');
      const row = await tx.schoolCashflowItem.update({
        where: { id },
        data: {
          direction: dto.direction,
          description: dto.description.trim(),
          amount: dto.amount,
          date: new Date(`${dto.date}T00:00:00Z`),
          repeat,
          repeatUntil: dto.repeatUntil ? new Date(`${dto.repeatUntil}T00:00:00Z`) : null,
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          active: dto.active ?? found.active,
        },
      });
      return itemView(row);
    });
  }

  async removeItem(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const found = await tx.schoolCashflowItem.findUnique({ where: { id } });
      if (!found) throw new NotFoundException('Item not found');
      await tx.schoolCashflowItem.delete({ where: { id } });
      return { deleted: true };
    });
  }
}

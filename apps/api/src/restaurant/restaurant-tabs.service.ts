import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KitchenTicketStatus,
  Prisma,
  RestaurantTabLineStatus,
  RestaurantTabStatus,
  RestaurantTableStatus,
} from '@prisma/client';
import { variantTitle } from '../catalog/variant-title';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  AddTabLineDto,
  AddTabLinesDto,
  BillQueryDto,
  CancelTabDto,
  MoveTabDto,
  OpenTabDto,
  VoidTabLineDto,
} from './dto/tab.dto';
import { resolveLineStations } from './station-routing';
import {
  billTotals,
  isSupervisorOrAbove,
  openProblem,
  round2,
  splitEqual,
  voidProblem,
} from './tab-bill.util';

const TAB_INCLUDE = {
  table: { select: { id: true, label: true, branchId: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        include: {
          product: {
            select: {
              name: true,
              taxClass: { select: { rate: true, isExempt: true } },
            },
          },
        },
      },
      station: { select: { name: true } },
    },
  },
  tabSales: { select: { saleId: true, label: true } },
};
type TabFull = Prisma.RestaurantTabGetPayload<{ include: typeof TAB_INCLUDE }>;

const taxRateOf = (tc: { rate: unknown; isExempt: boolean } | null) =>
  tc && !tc.isExempt ? Number(tc.rate) : 0;

/** What the app shows for a tab: its items (priced as the sale will price them, today) and the total of what is still unpaid. */
export function toTabView(tab: TabFull) {
  const lines = tab.lines.map((l) => {
    const price = Number(l.variant.price);
    const taxRate = taxRateOf(l.variant.product.taxClass);
    const quantity = Number(l.quantity);
    return {
      id: l.id,
      variantId: l.variantId,
      title: variantTitle(l.variant.product.name, l.variant.name),
      quantity,
      unitPrice: price,
      orderedPrice: Number(l.unitPrice),
      taxRate,
      amount: billTotals([{ quantity, unitPrice: price, taxRate }]).total,
      stationId: l.stationId,
      stationName: l.station.name,
      courseNumber: l.courseNumber,
      notes: l.notes,
      status: l.status,
      voidReason: l.voidReason,
      kitchenTicketId: l.kitchenTicketId,
    };
  });
  const unpaid = tab.lines.filter(
    (l) => l.status === RestaurantTabLineStatus.ORDERED,
  );
  const totals = billTotals(
    unpaid.map((l) => ({
      quantity: Number(l.quantity),
      unitPrice: Number(l.variant.price),
      taxRate: taxRateOf(l.variant.product.taxClass),
    })),
  );
  return {
    id: tab.id,
    status: tab.status,
    table: { id: tab.table.id, label: tab.table.label },
    branchId: tab.branchId,
    openedAt: tab.openedAt,
    closedAt: tab.closedAt,
    guestCount: tab.guestCount,
    notes: tab.notes,
    voidReason: tab.voidReason,
    saleIds: tab.tabSales.map((s) => s.saleId),
    lines,
    unpaidCount: unpaid.length,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
  };
}

/** Open bills: a running tab per table, items sent to the kitchen as they are ordered, paid at the end (see RestaurantTabPaymentsService). */
@Injectable()
export class RestaurantTabsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async loadTab(tx: TenantTx, id: string): Promise<TabFull> {
    const tab = await tx.restaurantTab.findUnique({
      where: { id },
      include: TAB_INCLUDE,
    });
    if (!tab) throw new NotFoundException('Bill not found');
    return tab;
  }

  private async openTabOrThrow(tx: TenantTx, id: string): Promise<TabFull> {
    const tab = await this.loadTab(tx, id);
    if (tab.status !== RestaurantTabStatus.OPEN)
      throw new ConflictException('This bill is already closed');
    return tab;
  }

  async view(tabId: string) {
    return this.tenantPrisma.run(async (tx) =>
      toTabView(await this.loadTab(tx, tabId)),
    );
  }

  /** The open bill on a table, or null. */
  async openTabForTable(tableId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const tab = await tx.restaurantTab.findFirst({
        where: { tableId, status: RestaurantTabStatus.OPEN },
        include: TAB_INCLUDE,
      });
      return tab ? toTabView(tab) : null;
    });
  }

  async open(tableId: string, dto: OpenTabDto) {
    const { organizationId, orgUserId } = getTenantStore();
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const table = await tx.restaurantTable.findUnique({
          where: { id: tableId },
        });
        if (!table || table.archivedAt)
          throw new NotFoundException('Table not found');
        const problem = openProblem(
          (await tx.restaurantTab.count({
            where: { tableId, status: RestaurantTabStatus.OPEN },
          })) > 0,
        );
        if (problem) throw new ConflictException(problem);

        const tab = await tx.restaurantTab.create({
          data: {
            organizationId,
            branchId: table.branchId,
            tableId,
            openedBy: orgUserId,
            guestCount: dto.guestCount ?? 1,
            notes: dto.notes || null,
          },
        });
        await tx.restaurantTable.update({
          where: { id: tableId },
          data: { status: RestaurantTableStatus.OCCUPIED },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.tab_opened',
          entityType: 'RestaurantTab',
          entityId: tab.id,
          after: { tableId, guestCount: tab.guestCount },
        });
        return toTabView(await this.loadTab(tx, tab.id));
      });
    } catch (e) {
      // two people tapping the same free table at once: the one-open-bill-per-table index decides
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('This table already has an open bill');
      throw e;
    }
  }

  /** Adds items and sends them to the kitchen at once (course 1) or holds them (later courses). One ticket per station and course. */
  async addLines(tabId: string, dto: AddTabLinesDto) {
    const { orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const tab = await this.openTabOrThrow(tx, tabId);
      const variantIds = [...new Set(dto.lines.map((l) => l.variantId))];
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
      });
      if (variants.length !== variantIds.length)
        throw new NotFoundException('One of those items was not found');
      const priceOf = new Map(variants.map((v) => [v.id, Number(v.price)]));
      const stationIds = await resolveLineStations(tx, tab.branchId, dto.lines);

      const groups = new Map<
        string,
        { line: AddTabLineDto; stationId: string }[]
      >();
      dto.lines.forEach((line, i) => {
        const key = `${stationIds[i]}::${line.courseNumber ?? 1}`;
        groups.set(key, [
          ...(groups.get(key) ?? []),
          { line, stationId: stationIds[i] },
        ]);
      });

      const now = new Date();
      for (const [key, group] of groups) {
        const [stationId, course] = key.split('::');
        const courseNumber = Number(course);
        const fireNow = courseNumber <= 1;
        const ticket = await tx.kitchenTicket.create({
          data: {
            tabId,
            stationId,
            courseNumber,
            status: fireNow
              ? KitchenTicketStatus.QUEUED
              : KitchenTicketStatus.HELD,
            firedAt: fireNow ? now : null,
          },
        });
        for (const { line } of group) {
          const kl = await tx.kitchenTicketLine.create({
            // a kitchen ticket is "make N of these", so a whole number (the bill keeps the exact quantity)
            data: {
              ticketId: ticket.id,
              variantId: line.variantId,
              quantity: Math.max(1, Math.round(line.quantity)),
              notes: line.notes || null,
            },
          });
          await tx.restaurantTabLine.create({
            data: {
              tabId,
              variantId: line.variantId,
              quantity: line.quantity,
              unitPrice: priceOf.get(line.variantId)!,
              stationId,
              courseNumber,
              notes: line.notes || null,
              addedById: orgUserId,
              kitchenTicketId: ticket.id,
              kitchenTicketLineId: kl.id,
            },
          });
        }
      }
      await tx.restaurantTable.updateMany({
        where: {
          id: tab.tableId,
          status: { not: RestaurantTableStatus.OCCUPIED },
        },
        data: { status: RestaurantTableStatus.OCCUPIED },
      });
      return toTabView(await this.loadTab(tx, tabId));
    });
  }

  /** Takes an unpaid item off the bill. Supervisor and above, with a reason. The kitchen sees it struck through. */
  async voidLine(tabId: string, lineId: string, dto: VoidTabLineDto) {
    const { role, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const tab = await this.openTabOrThrow(tx, tabId);
      const line = tab.lines.find((l) => l.id === lineId);
      if (!line) throw new NotFoundException('That item is not on this bill');
      const problem = voidProblem(role, line, dto.reason);
      if (problem)
        throw new (
          isSupervisorOrAbove(role) ? BadRequestException : ForbiddenException
        )(problem);

      const res = await tx.restaurantTabLine.updateMany({
        where: { id: lineId, status: RestaurantTabLineStatus.ORDERED },
        data: {
          status: RestaurantTabLineStatus.VOIDED,
          voidReason: dto.reason,
          voidedById: orgUserId,
          voidedAt: new Date(),
          claimClientId: null,
          claimedAt: null,
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'That item was just paid for or voided by someone else',
        );
      if (line.kitchenTicketLineId)
        await tx.kitchenTicketLine.update({
          where: { id: line.kitchenTicketLineId },
          data: { voidedAt: new Date() },
        });
      await this.auditLog.logInTx(tx, {
        action: 'restaurant.tab_line_voided',
        entityType: 'RestaurantTabLine',
        entityId: lineId,
        before: {
          tabId,
          variantId: line.variantId,
          quantity: Number(line.quantity),
          status: line.status,
        },
        after: { status: 'VOIDED', reason: dto.reason },
      });
      return toTabView(await this.loadTab(tx, tabId));
    });
  }

  /** Moves the bill (and where its kitchen tickets say the food goes) to another free table. */
  async move(tabId: string, dto: MoveTabDto) {
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const tab = await this.openTabOrThrow(tx, tabId);
        if (dto.tableId === tab.tableId)
          throw new BadRequestException('The bill is already on that table');
        const target = await tx.restaurantTable.findUnique({
          where: { id: dto.tableId },
        });
        if (!target || target.archivedAt)
          throw new NotFoundException('Table not found');
        if (target.branchId !== tab.branchId)
          throw new BadRequestException('That table is at a different branch');
        const problem = openProblem(
          (await tx.restaurantTab.count({
            where: { tableId: dto.tableId, status: RestaurantTabStatus.OPEN },
          })) > 0,
        );
        if (problem)
          throw new ConflictException(
            `That table is not free: ${problem.toLowerCase()}`,
          );

        await tx.restaurantTab.update({
          where: { id: tabId },
          data: { tableId: dto.tableId },
        });
        await tx.restaurantTable.update({
          where: { id: tab.tableId },
          data: { status: RestaurantTableStatus.NEEDS_CLEANING },
        });
        await tx.restaurantTable.update({
          where: { id: dto.tableId },
          data: { status: RestaurantTableStatus.OCCUPIED },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.tab_moved',
          entityType: 'RestaurantTab',
          entityId: tabId,
          before: { tableId: tab.tableId },
          after: { tableId: dto.tableId },
        });
        return toTabView(await this.loadTab(tx, tabId));
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('That table already has an open bill');
      throw e;
    }
  }

  /** Throws a bill away (guests left, opened by mistake). Nothing may be paid yet; with items on it, a supervisor must do it. */
  async cancel(tabId: string, dto: CancelTabDto) {
    const { role, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const tab = await this.openTabOrThrow(tx, tabId);
      if (tab.lines.some((l) => l.status === RestaurantTabLineStatus.PAID))
        throw new ConflictException(
          'Part of this bill has been paid, so it cannot be thrown away',
        );
      const unpaid = tab.lines.filter(
        (l) => l.status === RestaurantTabLineStatus.ORDERED,
      );
      if (unpaid.length > 0) {
        const problem = voidProblem(role, { status: 'ORDERED' }, dto.reason);
        if (problem)
          throw new (
            isSupervisorOrAbove(role) ? BadRequestException : ForbiddenException
          )(problem);
        await tx.restaurantTabLine.updateMany({
          where: { tabId, status: RestaurantTabLineStatus.ORDERED },
          data: {
            status: RestaurantTabLineStatus.VOIDED,
            voidReason: dto.reason,
            voidedById: orgUserId,
            voidedAt: new Date(),
            claimClientId: null,
            claimedAt: null,
          },
        });
        await tx.kitchenTicketLine.updateMany({
          where: {
            id: {
              in: unpaid
                .map((l) => l.kitchenTicketLineId)
                .filter((x): x is string => Boolean(x)),
            },
          },
          data: { voidedAt: new Date() },
        });
      }
      await tx.restaurantTab.update({
        where: { id: tabId },
        data: {
          status: RestaurantTabStatus.VOID,
          closedAt: new Date(),
          voidReason: dto.reason || null,
        },
      });
      await tx.restaurantTable.update({
        where: { id: tab.tableId },
        data: { status: RestaurantTableStatus.AVAILABLE },
      });
      await this.auditLog.logInTx(tx, {
        action: 'restaurant.tab_voided',
        entityType: 'RestaurantTab',
        entityId: tabId,
        after: { reason: dto.reason ?? null, itemsVoided: unpaid.length },
      });
      return toTabView(await this.loadTab(tx, tabId));
    });
  }

  /** The bill before it is paid: what is owed, optionally for chosen items, and what each of N would pay if split equally. */
  async bill(tabId: string, query: BillQueryDto) {
    return this.tenantPrisma.run(async (tx) => {
      const tab = await this.loadTab(tx, tabId);
      const view = toTabView(tab);
      const wanted = query.lineIds ? new Set(query.lineIds.split(',')) : null;
      const lines = view.lines.filter(
        (l) => l.status === 'ORDERED' && (!wanted || wanted.has(l.id)),
      );
      if (wanted && lines.length !== wanted.size)
        throw new BadRequestException(
          'One of those items is not an unpaid item on this bill',
        );
      const totals = billTotals(
        lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
        })),
      );
      const org = await tx.organization.findUnique({
        where: { id: getTenantStore().organizationId },
        select: { name: true },
      });
      const shares = query.split ? splitEqual(totals.total, query.split) : null;
      const money = (n: number) =>
        n.toLocaleString('en-KE', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      const text = [
        `${org?.name ?? 'Bill'} - ${view.table.label}`,
        ...lines.map(
          (l) => `${l.quantity} x ${l.title}   KES ${money(l.amount)}`,
        ),
        `Total: KES ${money(totals.total)}`,
        ...(shares
          ? [`Split ${query.split} ways: KES ${money(shares[0])} each`]
          : []),
      ].join('\n');
      return {
        business: org?.name ?? '',
        table: view.table,
        openedAt: view.openedAt,
        guestCount: view.guestCount,
        lines,
        ...totals,
        total: round2(totals.total),
        split: shares,
        text,
      };
    });
  }

  // ── Courses held for later ─────────────────────────────────────────────

  /** Courses waiting to be fired on a table - from its open bill and from a pay-first order - so they survive a refresh. */
  async heldCourses(tableId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const tickets = await tx.kitchenTicket.findMany({
        where: {
          status: KitchenTicketStatus.HELD,
          OR: [
            { tab: { tableId, status: RestaurantTabStatus.OPEN } },
            { sale: { restaurantTable: { tableId } } },
          ],
        },
        include: {
          lines: {
            where: { voidedAt: null },
            include: {
              variant: { include: { product: { select: { name: true } } } },
            },
          },
          station: { select: { name: true } },
        },
        orderBy: [{ courseNumber: 'asc' }, { createdAt: 'asc' }],
      });
      const groups = new Map<
        string,
        {
          source: 'TAB' | 'SALE';
          tabId: string | null;
          saleId: string | null;
          courseNumber: number;
          items: { title: string; quantity: number; station: string }[];
        }
      >();
      for (const t of tickets) {
        const items = t.lines.map((l) => ({
          title: variantTitle(l.variant.product.name, l.variant.name),
          quantity: l.quantity,
          station: t.station.name,
        }));
        if (items.length === 0) continue;
        const key = `${t.tabId ?? t.saleId}::${t.courseNumber}`;
        const group = groups.get(key) ?? {
          source: (t.tabId ? 'TAB' : 'SALE') as 'TAB' | 'SALE',
          tabId: t.tabId,
          saleId: t.saleId,
          courseNumber: t.courseNumber,
          items: [],
        };
        group.items.push(...items);
        groups.set(key, group);
      }
      return Array.from(groups.values());
    });
  }

  /** Sends a held course to the kitchen. Firing twice does nothing the second time. */
  async fireCourse(tabId: string, courseNumber: number) {
    return this.tenantPrisma.run(async (tx) => {
      const tab = await this.loadTab(tx, tabId);
      if (tab.status !== RestaurantTabStatus.OPEN)
        throw new ConflictException('This bill is already closed');
      const held = await tx.kitchenTicket.findMany({
        where: { tabId, courseNumber, status: KitchenTicketStatus.HELD },
        select: { id: true },
      });
      if (held.length === 0) return { fired: 0 };
      await tx.kitchenTicket.updateMany({
        where: { id: { in: held.map((t) => t.id) } },
        data: { status: KitchenTicketStatus.QUEUED, firedAt: new Date() },
      });
      return { fired: held.length };
    });
  }
}

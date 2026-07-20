import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KitchenTicketStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { TableOrderLineItemDto } from './dto/table-order-line-item.dto';

const TICKET_INCLUDE = {
  lines: { include: { variant: { include: { product: true } } } },
  station: true,
} as const;

// Strict forward-only sequence - no skipping ahead, no going back. A KDS
// screen advances a ticket one stage at a time; anything else (marking
// READY before IN_PROGRESS, or re-opening a SERVED ticket) is treated as
// a client bug, not a valid kitchen workflow.
const NEXT_STATUS: Partial<Record<KitchenTicketStatus, KitchenTicketStatus>> = {
  [KitchenTicketStatus.QUEUED]: KitchenTicketStatus.IN_PROGRESS,
  [KitchenTicketStatus.IN_PROGRESS]: KitchenTicketStatus.READY,
  [KitchenTicketStatus.READY]: KitchenTicketStatus.SERVED,
};
const STATUS_TIMESTAMP_FIELD: Partial<
  Record<KitchenTicketStatus, 'startedAt' | 'readyAt' | 'servedAt'>
> = {
  [KitchenTicketStatus.IN_PROGRESS]: 'startedAt',
  [KitchenTicketStatus.READY]: 'readyAt',
  [KitchenTicketStatus.SERVED]: 'servedAt',
};

@Injectable()
export class KitchenTicketsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /**
   * Standalone pre-check, called by RestaurantSalesService BEFORE
   * SalesService.create() - see that method's comment for why validating
   * this ahead of any core state change matters. createTicketsInTx below
   * re-checks anyway once inside its own transaction (cheap, and guards
   * against a station being deleted in the gap between this check and
   * ticket creation), so this isn't the only guard - just the one that
   * runs early enough to actually prevent a paid-for order with no
   * kitchen ticket.
   */
  async assertStationsExist(stationIds: string[]) {
    const uniqueIds = [...new Set(stationIds)];
    const stations = await this.tenantPrisma.run((tx) =>
      tx.kitchenStation.findMany({ where: { id: { in: uniqueIds } } }),
    );
    const found = new Set(stations.map((s) => s.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Unknown kitchen station(s): ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Splits an order's line items into one ticket per (station, course) -
   * so "the kitchen" sees one focused ticket per prep area rather than a
   * single ticket spanning stations that don't coordinate with each
   * other. Course 1 (or unspecified) fires immediately; anything higher
   * is created HELD and only reaches the KDS once explicitly fired via
   * fireCourse() - the actual course-timing mechanism.
   *
   * Takes an already-open tx (same recordInTx-style composability used
   * throughout this codebase - see InventoryTransactionsService) since
   * this always runs as part of RestaurantSalesService's own transaction,
   * never standalone.
   */
  async createTicketsInTx(
    tx: TenantTx,
    saleId: string,
    lineItems: TableOrderLineItemDto[],
  ) {
    const stationIds = [...new Set(lineItems.map((li) => li.stationId))];
    const stations = await tx.kitchenStation.findMany({
      where: { id: { in: stationIds } },
    });
    const stationById = new Map(stations.map((s) => [s.id, s]));
    const missing = stationIds.filter((id) => !stationById.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Unknown kitchen station(s): ${missing.join(', ')}`,
      );
    }

    const groups = new Map<string, TableOrderLineItemDto[]>();
    for (const li of lineItems) {
      const courseNumber = li.courseNumber ?? 1;
      const key = `${li.stationId}::${courseNumber}`;
      const group = groups.get(key) ?? [];
      group.push(li);
      groups.set(key, group);
    }

    const tickets = [];
    for (const [key, group] of groups) {
      const [stationId, courseNumberStr] = key.split('::');
      const courseNumber = Number(courseNumberStr);
      const isFirstCourse = courseNumber <= 1;
      const ticket = await tx.kitchenTicket.create({
        data: {
          saleId,
          stationId,
          courseNumber,
          status: isFirstCourse
            ? KitchenTicketStatus.QUEUED
            : KitchenTicketStatus.HELD,
          firedAt: isFirstCourse ? new Date() : null,
          lines: {
            create: group.map((li) => ({
              variantId: li.variantId,
              quantity: li.quantity,
              notes: li.notes,
            })),
          },
        },
        include: TICKET_INCLUDE,
      });
      tickets.push(ticket);
    }
    return tickets;
  }

  findAll(filters: { stationId?: string; status?: KitchenTicketStatus }) {
    return this.tenantPrisma.run((tx) =>
      tx.kitchenTicket.findMany({
        where: { stationId: filters.stationId, status: filters.status },
        include: TICKET_INCLUDE,
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    );
  }

  /**
   * Advances exactly one step (QUEUED -> IN_PROGRESS -> READY -> SERVED).
   * HELD tickets aren't reachable here at all - they can only leave HELD
   * via fireCourse(), so a kitchen screen can't accidentally "start" a
   * course that hasn't been fired yet.
   */
  async advanceStatus(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const ticket = await tx.kitchenTicket.findUnique({ where: { id } });
      if (!ticket) throw new NotFoundException('Ticket not found');

      const next = NEXT_STATUS[ticket.status];
      if (!next) {
        throw new BadRequestException(
          ticket.status === KitchenTicketStatus.HELD
            ? 'This course has not been fired yet - use the fire-course endpoint, not a direct status update'
            : `A ${ticket.status.toLowerCase()} ticket cannot be advanced further`,
        );
      }

      const timestampField = STATUS_TIMESTAMP_FIELD[next];
      return tx.kitchenTicket.update({
        where: { id },
        data: {
          status: next,
          ...(timestampField ? { [timestampField]: new Date() } : {}),
        },
        include: TICKET_INCLUDE,
      });
    });
  }

  /**
   * The course-timing mechanism: transitions every HELD ticket for this
   * sale+course to QUEUED at once, so e.g. dessert doesn't reach the
   * kitchen until staff explicitly fire it (typically once mains are
   * cleared). A course with nothing HELD (already fired, or never
   * existed) is a no-op rather than an error - firing is idempotent, the
   * same principle applied to sale submission elsewhere in this system.
   */
  async fireCourse(saleId: string, courseNumber: number) {
    return this.tenantPrisma.run(async (tx) => {
      const held = await tx.kitchenTicket.findMany({
        where: { saleId, courseNumber, status: KitchenTicketStatus.HELD },
      });
      if (held.length === 0) return [];

      await tx.kitchenTicket.updateMany({
        where: { id: { in: held.map((t) => t.id) } },
        data: { status: KitchenTicketStatus.QUEUED, firedAt: new Date() },
      });

      return tx.kitchenTicket.findMany({
        where: { id: { in: held.map((t) => t.id) } },
        include: TICKET_INCLUDE,
      });
    });
  }
}

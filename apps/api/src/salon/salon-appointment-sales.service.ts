import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SalonAppointmentStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { SalesService } from '../sales/sales.service';
import { CheckoutAppointmentDto } from './dto/checkout-appointment.dto';

@Injectable()
export class SalonAppointmentSalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sales: SalesService,
  ) {}

  /**
   * A module calling into core exactly as the restaurant/pharmacy
   * modules already do: this service imports and calls
   * SalesService.create() directly, getting every core guarantee
   * (idempotency, discount/loyalty handling, inventory decrement, audit
   * logging, the sale hooks) for free.
   *
   * Only an IN_PROGRESS or COMPLETED appointment can be checked out -
   * validated BEFORE calling core, the same lesson already applied
   * twice: a service that hasn't happened yet (SCHEDULED/CONFIRMED)
   * shouldn't be charged for, and a cancelled/no-show appointment
   * definitely shouldn't be. Checking out an IN_PROGRESS appointment
   * also marks it COMPLETED - checkout is the natural point a service
   * visit actually finishes.
   *
   * Not atomic across steps (complete the sale -> link it to the
   * appointment) for the same accepted-risk reason as the restaurant/
   * pharmacy modules: SalesService.create() always commits its own
   * transaction first. The sale itself is never at risk, only the
   * link, which is cheap to reconcile.
   */
  async checkout(appointmentId: string, dto: CheckoutAppointmentDto) {
    const appointment = await this.tenantPrisma.run((tx) =>
      tx.salonAppointment.findUnique({
        where: { id: appointmentId },
        include: { sale: true },
      }),
    );
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.sale) {
      // Idempotent the same way the sale itself is - resolve to the
      // already-linked sale rather than erroring or double-charging.
      const sale = await this.sales.findOne(appointment.sale.saleId);
      return { sale, link: appointment.sale };
    }
    if (
      appointment.status !== SalonAppointmentStatus.IN_PROGRESS &&
      appointment.status !== SalonAppointmentStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Cannot check out an appointment that is ${appointment.status.toLowerCase()} - it must be in progress or completed`,
      );
    }

    const sale = await this.sales.create({
      clientId: dto.clientId,
      branchId: appointment.branchId,
      terminalId: dto.terminalId,
      cashierSessionId: dto.cashierSessionId,
      shiftId: dto.shiftId,
      lineItems: dto.lineItems,
      payments: dto.payments,
      discount: dto.discount,
      customerId: dto.customerId,
      redeemPoints: dto.redeemPoints,
    });

    return this.tenantPrisma.run(async (tx) => {
      const existingLink = await tx.salonAppointmentSale.findUnique({
        where: { saleId: sale.id },
      });
      const link =
        existingLink ??
        (await tx.salonAppointmentSale.create({
          data: { appointmentId, saleId: sale.id },
        }));

      if (appointment.status === SalonAppointmentStatus.IN_PROGRESS) {
        await tx.salonAppointment.update({
          where: { id: appointmentId },
          data: { status: SalonAppointmentStatus.COMPLETED },
        });
      }

      return { sale, link };
    });
  }
}

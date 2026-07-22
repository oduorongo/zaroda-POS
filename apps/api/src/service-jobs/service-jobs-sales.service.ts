import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServiceJobStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { SalesService } from '../sales/sales.service';
import { InvoiceServiceJobDto } from './dto/invoice-service-job.dto';

@Injectable()
export class ServiceJobsSalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sales: SalesService,
  ) {}

  /**
   * Same "module calls into core" pattern as
   * SalonAppointmentSalesService.checkout(): this composes a normal
   * CreateSaleDto from the job's branch + the client-supplied line items
   * (parts and labor, both plain catalog variants) and calls
   * SalesService.create() directly, getting idempotency, inventory
   * decrement, discount/loyalty handling, and audit logging for free. Only
   * an IN_PROGRESS, WAITING_PARTS, or COMPLETED job can be invoiced - a job
   * that hasn't started yet shouldn't be charged for.
   */
  async invoice(jobId: string, dto: InvoiceServiceJobDto) {
    const job = await this.tenantPrisma.run((tx) =>
      tx.serviceJob.findUnique({ where: { id: jobId }, include: { sale: true } }),
    );
    if (!job) throw new NotFoundException('Service job not found');
    if (job.sale) {
      // Idempotent the same way the sale itself is - resolve to the
      // already-linked sale rather than erroring or double-charging.
      const sale = await this.sales.findOne(job.sale.saleId);
      return { sale, link: job.sale };
    }
    if (
      job.status !== ServiceJobStatus.IN_PROGRESS &&
      job.status !== ServiceJobStatus.WAITING_PARTS &&
      job.status !== ServiceJobStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Cannot invoice a job that is ${job.status.toLowerCase()} - it must be in progress, waiting on parts, or completed`,
      );
    }

    const sale = await this.sales.create({
      clientId: dto.clientId,
      branchId: job.branchId,
      terminalId: dto.terminalId,
      cashierSessionId: dto.cashierSessionId,
      shiftId: dto.shiftId,
      lineItems: dto.lineItems,
      payments: dto.payments,
      discount: dto.discount,
      customerId: job.customerId ?? undefined,
      redeemPoints: dto.redeemPoints,
    });

    return this.tenantPrisma.run(async (tx) => {
      const existingLink = await tx.serviceJobSale.findUnique({
        where: { saleId: sale.id },
      });
      const link =
        existingLink ??
        (await tx.serviceJobSale.create({
          data: { jobId, saleId: sale.id },
        }));

      if (job.status !== ServiceJobStatus.COMPLETED) {
        await tx.serviceJob.update({
          where: { id: jobId },
          data: { status: ServiceJobStatus.COMPLETED, closedAt: new Date() },
        });
      }

      return { sale, link };
    });
  }
}

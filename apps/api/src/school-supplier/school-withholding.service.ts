import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupplierPaymentMethod, SupplierPaymentStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { CertificateDto } from './dto/school-supplier.dto';
import { daysBetween, todayKey } from './school-money.util';
import { certificateStatus, withheldTotals } from './school-withholding.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Tax the schools withheld when they paid. Each is recorded as a payment of its own kind (it settles the invoice like money
 * does); the school then sends a withholding certificate, which is what lets the supplier claim the tax against its own income tax.
 * This keeps the list of what was withheld, which certificates have come and which are still missing.
 */
@Injectable()
export class SchoolWithholdingService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** What was withheld in a period, by school, and which certificates are still missing. */
  async summary(from?: string, to?: string) {
    const today = todayKey();
    const rows = await this.tenantPrisma.run((tx) =>
      tx.supplierPayment.findMany({
        where: {
          method: SupplierPaymentMethod.WITHHOLDING_TAX,
          status: SupplierPaymentStatus.RECEIVED,
          ...(from || to
            ? {
                receivedOn: {
                  ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
                  ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
                },
              }
            : {}),
        },
        include: { school: { select: { id: true, name: true } } },
        orderBy: [{ receivedOn: 'desc' }, { receiptNumber: 'desc' }],
        take: 500,
      }),
    );
    const list = rows.map((p) => {
      const receivedOn = day(p.receivedOn)!;
      return {
        id: p.id,
        receiptNumber: p.receiptNumber,
        school: p.school,
        receivedOn,
        amount: Number(p.amount),
        reference: p.reference,
        certificateNumber: p.whtCertificateNumber,
        certificateReceivedOn: day(p.whtCertificateReceivedOn),
        daysWaiting: daysBetween(receivedOn, today),
        certificate: certificateStatus(
          p.whtCertificateNumber,
          receivedOn,
          today,
        ),
      };
    });
    return {
      from: from ?? null,
      to: to ?? null,
      totals: withheldTotals(
        list.map((r) => ({
          schoolId: r.school.id,
          schoolName: r.school.name,
          amount: r.amount,
          hasCertificate: r.certificate === 'RECEIVED',
        })),
      ),
      rows: list,
    };
  }

  /** The school's certificate has come: note its number and the day. */
  async setCertificate(paymentId: string, dto: CertificateDto) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await tx.supplierPayment.findUnique({
        where: { id: paymentId },
      });
      if (!p) throw new NotFoundException('Payment not found');
      if (p.method !== SupplierPaymentMethod.WITHHOLDING_TAX)
        throw new BadRequestException(
          'Only a payment of tax withheld has a withholding certificate.',
        );
      if (p.status !== SupplierPaymentStatus.RECEIVED)
        throw new ConflictException('That payment was cancelled.');
      const receivedOn = dto.receivedOn ?? todayKey();
      if (receivedOn < day(p.receivedOn)!)
        throw new BadRequestException(
          'The certificate cannot have arrived before the tax was withheld.',
        );
      const updated = await tx.supplierPayment.update({
        where: { id: paymentId },
        data: {
          whtCertificateNumber: dto.certificateNumber.trim(),
          whtCertificateReceivedOn: new Date(`${receivedOn}T00:00:00Z`),
        },
      });
      await this.audit.logInTx(tx, {
        action: 'school.wht_certificate',
        entityType: 'SupplierPayment',
        entityId: paymentId,
        after: { certificateNumber: updated.whtCertificateNumber, receivedOn },
      });
      return {
        id: updated.id,
        certificateNumber: updated.whtCertificateNumber,
        certificateReceivedOn: day(updated.whtCertificateReceivedOn),
      };
    });
  }
}

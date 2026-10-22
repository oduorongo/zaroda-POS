import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Role, SchoolStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { tenantContext } from '../../common/tenant/tenant-context';
import { variantTitle } from '../../catalog/variant-title';
import { SubmitSchoolOrderDto } from '../dto/school-supplier.dto';
import { SchoolBillingService } from '../school-billing.service';
import { SchoolOrdersService } from '../school-orders.service';
import { SchoolsService } from '../schools.service';
import { SchoolIdentity } from './school-auth';

/**
 * What a signed-in school may see and do. The token names the school and its supplier; every call runs inside that
 * supplier's own context and is filtered to that one school, so a school can only ever reach its own orders, invoices and
 * receipts - another school's id simply is not found. A school suspended after it signed in is turned away on its next call.
 */
@Injectable()
export class SchoolPortalService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly orders: SchoolOrdersService,
    private readonly billing: SchoolBillingService,
    private readonly schools: SchoolsService,
  ) {}

  private async asSchool<T>(
    who: SchoolIdentity,
    fn: () => Promise<T>,
  ): Promise<T> {
    return tenantContext.run(
      {
        organizationId: who.organizationId,
        orgUserId: 'school-portal',
        role: Role.CASHIER,
      },
      async () => {
        const school = await this.tenantPrisma.run((tx) =>
          tx.supplierSchool.findUnique({
            where: { id: who.schoolId },
            select: { status: true },
          }),
        );
        if (!school || school.status !== SchoolStatus.ACTIVE)
          throw new UnauthorizedException(
            'This account is no longer active. Please contact your supplier.',
          );
        return fn();
      },
    );
  }

  me(who: SchoolIdentity) {
    return this.asSchool(who, async () => {
      const [school, business] = await Promise.all([
        this.schools.get(who.schoolId),
        this.billing.letterhead(),
      ]);
      return {
        school,
        supplier: {
          name: business.name,
          phone: business.phone,
          email: business.email,
        },
      };
    });
  }

  /** The items the supplier has put on the list, at the price this school pays (before VAT, with the VAT rate shown). */
  priceList(who: SchoolIdentity) {
    return this.asSchool(who, async () => {
      const variants = await this.tenantPrisma.run((tx) =>
        tx.productVariant.findMany({
          where: { onSchoolList: true },
          include: {
            product: {
              select: {
                name: true,
                category: { select: { name: true } },
                taxClass: { select: { rate: true, isExempt: true } },
              },
            },
          },
          orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
          take: 3000,
        }),
      );
      return variants.map((v) => ({
        variantId: v.id,
        title: variantTitle(v.product.name, v.name),
        sku: v.sku,
        category: v.product.category?.name ?? null,
        unitPrice: Number(v.schoolPrice ?? v.price),
        taxRate:
          v.product.taxClass && !v.product.taxClass.isExempt
            ? Number(v.product.taxClass.rate)
            : 0,
        allowsFractions: v.quantityMode === 'WEIGHT',
      }));
    });
  }

  submitOrder(who: SchoolIdentity, dto: SubmitSchoolOrderDto) {
    return this.asSchool(who, () => this.orders.submit(who.schoolId, dto));
  }
  listOrders(who: SchoolIdentity) {
    return this.asSchool(who, () => this.orders.listForSchool(who.schoolId));
  }
  getOrder(who: SchoolIdentity, id: string) {
    return this.asSchool(who, async () => ({
      ...(await this.orders.getForSchool(who.schoolId, id)),
      business: await this.billing.letterhead(),
    }));
  }
  cancelOrder(who: SchoolIdentity, id: string, reason?: string) {
    return this.asSchool(who, () =>
      this.orders.cancelBySchool(who.schoolId, id, reason),
    );
  }
  listInvoices(who: SchoolIdentity) {
    return this.asSchool(who, () =>
      this.billing.listInvoicesForSchool(who.schoolId),
    );
  }
  getInvoice(who: SchoolIdentity, id: string) {
    return this.asSchool(who, () => this.billing.getInvoice(id, who.schoolId));
  }
  listReceipts(who: SchoolIdentity) {
    return this.asSchool(who, () => this.billing.listPayments(who.schoolId));
  }
  getReceipt(who: SchoolIdentity, id: string) {
    return this.asSchool(who, () => this.billing.getPayment(id, who.schoolId));
  }
  statement(who: SchoolIdentity, from?: string, to?: string) {
    return this.asSchool(who, async () => ({
      ...(await this.schools.statement(who.schoolId, from, to)),
      business: await this.billing.letterhead(),
    }));
  }
}

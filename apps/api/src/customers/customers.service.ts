import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async create(dto: CreateCustomerDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run((tx) =>
        tx.customer.create({
          data: { organizationId, name: dto.name, phone: dto.phone },
        }),
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A customer with this phone number already exists',
        );
      }
      throw e;
    }
  }

  findAll(filters: { search?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.customer.findMany({
        where: filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { phone: { contains: filters.search } },
              ],
            }
          : undefined,
        orderBy: { name: 'asc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const customer = await this.tenantPrisma.run((tx) =>
      tx.customer.findUnique({ where: { id } }),
    );
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** For callers already inside a TenantScopedPrismaService transaction (SalesService) - see InventoryTransactionsService.recordInTx for why this split exists. */
  findByIdInTx(tx: TenantTx, id: string) {
    return tx.customer.findUnique({ where: { id } });
  }

  adjustPointsInTx(tx: TenantTx, customerId: string, delta: number) {
    return tx.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: { increment: delta } },
    });
  }
}

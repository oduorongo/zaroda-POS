import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, Rider, RiderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { CreateShopRiderDto, UpdateRiderProfileDto } from './dto/rider.dto';

/** Everything a rider needs filled in before they can be approved or take a job. */
export const isProfileComplete = (r: Pick<Rider, 'fullName' | 'phone' | 'vehicleType'>) => Boolean(r.fullName && r.phone && r.vehicleType);

/** What is shown about a rider. SHOP = a business's own rider, POOL = the shared pool. */
export function toRiderView(r: Rider) {
  return {
    id: r.id,
    email: r.email,
    fullName: r.fullName,
    phone: r.phone,
    vehicleType: r.vehicleType,
    plateNumber: r.plateNumber,
    area: r.area,
    status: r.status,
    kind: r.organizationId ? ('SHOP' as const) : ('POOL' as const),
    profileComplete: isProfileComplete(r),
    createdAt: r.createdAt,
  };
}

const clean = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
const cleanUpper = (v: string | undefined) => clean(v)?.toUpperCase() ?? (v === undefined ? undefined : null);

/**
 * Riders: a rider's own profile, a business's own riders, and the platform admin's approval
 * queue. The riders table has no row-level security (a rider works across businesses), so
 * EVERY method here scopes itself: by the verified rider id, by the business's id, or runs as
 * platform admin. Nothing here ever returns another party's rows.
 */
@Injectable()
export class RidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  private phoneOrThrow(raw: string): string {
    const phone = normalizeKenyanPhone(raw);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    return phone;
  }

  private conflict(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
      throw new ConflictException(
        target.includes('phone') ? 'Another rider already uses that phone number' : 'That email address is already registered as a rider',
      );
    }
    throw e;
  }

  // ── The rider's own profile ───────────────────────────────────────────

  async getMe(riderId: string) {
    const rider = await this.prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new UnauthorizedException();
    return toRiderView(rider);
  }

  async updateMe(riderId: string, dto: UpdateRiderProfileDto) {
    try {
      const rider = await this.prisma.rider.update({
        where: { id: riderId },
        data: {
          fullName: clean(dto.fullName),
          phone: dto.phone === undefined ? undefined : this.phoneOrThrow(dto.phone),
          vehicleType: dto.vehicleType,
          plateNumber: cleanUpper(dto.plateNumber),
          area: clean(dto.area),
        },
      });
      return toRiderView(rider);
    } catch (e) {
      return this.conflict(e);
    }
  }

  // ── A business's own riders ───────────────────────────────────────────

  private async requireShopAddon(): Promise<string> {
    const { organizationId } = getTenantStore();
    const store = await this.tenantPrisma.run((tx) => tx.onlineStore.findUnique({ where: { organizationId }, select: { addonActive: true } }));
    if (!store?.addonActive) {
      throw new ForbiddenException('The Online Shop add-on is not active for this business - contact Zaroda to enable it');
    }
    return organizationId;
  }

  async listForShop() {
    const { organizationId } = getTenantStore();
    const riders = await this.prisma.rider.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    return riders.map(toRiderView);
  }

  async createForShop(dto: CreateShopRiderDto) {
    const organizationId = await this.requireShopAddon();
    try {
      const rider = await this.prisma.rider.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          fullName: dto.fullName.trim(),
          phone: this.phoneOrThrow(dto.phone),
          vehicleType: dto.vehicleType,
          plateNumber: cleanUpper(dto.plateNumber),
          area: clean(dto.area),
          organizationId,
          // The business vouches for its own riders, so no Zaroda approval is needed.
          status: RiderStatus.APPROVED,
          approvedAt: new Date(),
        },
      });
      return toRiderView(rider);
    } catch (e) {
      return this.conflict(e);
    }
  }

  private async ownRider(id: string): Promise<Rider> {
    const { organizationId } = getTenantStore();
    // findFirst with the business in the where: a rider of another business or the pool is "not found" here.
    const rider = await this.prisma.rider.findFirst({ where: { id, organizationId } });
    if (!rider) throw new NotFoundException('Rider not found');
    return rider;
  }

  async updateForShop(id: string, dto: UpdateRiderProfileDto) {
    await this.ownRider(id);
    try {
      const rider = await this.prisma.rider.update({
        where: { id },
        data: {
          fullName: clean(dto.fullName),
          phone: dto.phone === undefined ? undefined : this.phoneOrThrow(dto.phone),
          vehicleType: dto.vehicleType,
          plateNumber: cleanUpper(dto.plateNumber),
          area: clean(dto.area),
        },
      });
      return toRiderView(rider);
    } catch (e) {
      return this.conflict(e);
    }
  }

  async setStatusForShop(id: string, status: 'APPROVED' | 'SUSPENDED') {
    await this.ownRider(id);
    const rider = await this.prisma.rider.update({
      where: { id },
      data: { status, approvedAt: status === RiderStatus.APPROVED ? new Date() : undefined },
    });
    return toRiderView(rider);
  }

  // ── Platform admin ────────────────────────────────────────────────────

  async listForAdmin(status?: RiderStatus) {
    const riders = await this.prisma.rider.findMany({
      where: { status },
      include: { organization: { select: { name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return riders.map(({ organization, ...r }) => ({ ...toRiderView(r), businessName: organization?.name ?? null }));
  }

  async setStatusForAdmin(id: string, status: 'APPROVED' | 'SUSPENDED') {
    const rider = await this.prisma.rider.findUnique({ where: { id } });
    if (!rider) throw new NotFoundException('Rider not found');
    if (status === RiderStatus.APPROVED && !isProfileComplete(rider)) {
      throw new BadRequestException('This rider has not finished their profile yet (name, phone and vehicle) - they cannot be approved');
    }
    const updated = await this.prisma.rider.update({
      where: { id },
      data: { status, approvedAt: status === RiderStatus.APPROVED ? new Date() : undefined },
    });
    return toRiderView(updated);
  }
}

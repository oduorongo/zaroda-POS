import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, Rider, RiderStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { CreateShopRiderDto, UpdateRiderProfileDto } from './dto/rider.dto';
import { generatePin, hashPin } from './rider-pin.util';

/** Everything a rider needs filled in before they can be approved or take a job. */
export const isProfileComplete = (r: Pick<Rider, 'fullName' | 'phone' | 'vehicleType'>) => Boolean(r.fullName && r.phone && r.vehicleType);

/** What is shown about a rider. SHOP = a business's own rider, POOL = the shared pool. */
export function toRiderView(r: Rider) {
  return {
    id: r.id,
    email: r.email,
    hasPin: Boolean(r.pinHash),
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
    private readonly config: ConfigService,
  ) {}

  private pinHashFor(pin: string): string {
    return hashPin(pin, this.config.getOrThrow<string>('BUYER_JWT_SECRET'));
  }

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

  /** A signed-in rider choosing their own PIN (needs a phone number on the profile - that is what they sign in with). */
  async setOwnPin(riderId: string, pin: string) {
    const rider = await this.prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new UnauthorizedException();
    if (!rider.phone) throw new BadRequestException('Add your phone number first - you sign in with it and your PIN');
    const updated = await this.prisma.rider.update({ where: { id: riderId }, data: { pinHash: this.pinHashFor(pin), pinFailCount: 0, pinLockedUntil: null } });
    return toRiderView(updated);
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
      const pin = generatePin();
      const rider = await this.prisma.rider.create({
        data: {
          email: dto.email?.trim().toLowerCase() || null,
          pinHash: this.pinHashFor(pin),
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
      // The PIN is shown to the business once, to pass on to the rider - only its hash is stored.
      return { ...toRiderView(rider), temporaryPin: pin };
    } catch (e) {
      return this.conflict(e);
    }
  }

  /**
   * A marketing team member signing a rider up. The rider joins the shared pool and waits for Zaroda's usual
   * approval (the team does not vouch for them the way a business does for its own riders); they then sign in
   * with their email like any rider. The credit to the member and team is set here, once.
   */
  async createForAgent(dto: CreateShopRiderDto, attribution: { salesTeamId: string; salesAgentId: string }) {
    try {
      const pin = generatePin();
      const rider = await this.prisma.rider.create({
        data: {
          email: dto.email?.trim().toLowerCase() || null,
          pinHash: this.pinHashFor(pin),
          fullName: dto.fullName.trim(),
          phone: this.phoneOrThrow(dto.phone),
          vehicleType: dto.vehicleType,
          plateNumber: cleanUpper(dto.plateNumber),
          area: clean(dto.area),
          status: RiderStatus.PENDING,
          ...attribution,
        },
      });
      return { ...toRiderView(rider), temporaryPin: pin };
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

  /** A new PIN for one of this business's riders (forgotten PIN, or a number we cannot text). Shown once. */
  async resetPinForShop(id: string) {
    const rider = await this.ownRider(id);
    return this.resetPin(rider);
  }

  async resetPinForAdmin(id: string) {
    const rider = await this.prisma.rider.findUnique({ where: { id } });
    if (!rider) throw new NotFoundException('Rider not found');
    return this.resetPin(rider);
  }

  private async resetPin(rider: Rider) {
    if (!rider.phone) throw new BadRequestException('This rider has no phone number yet - add one first');
    const pin = generatePin();
    const updated = await this.prisma.rider.update({ where: { id: rider.id }, data: { pinHash: this.pinHashFor(pin), pinFailCount: 0, pinLockedUntil: null } });
    return { ...toRiderView(updated), temporaryPin: pin };
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

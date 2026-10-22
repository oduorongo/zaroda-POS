import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  HotelSettingsDto,
  MealPricesDto,
  QuoteDto,
  RateCardDto,
  SeasonDto,
  TaxesDto,
} from './dto/hotel-ops.dto';
import {
  applyManagedTaxClass,
  MANAGED_TAX_CLASS_NAME,
} from './hotel-tax-class';
import { MEAL_PLANS } from './pricing.util';
import { combinedRate, nightPostings } from './tax.util';
import { activeTaxLines } from './hotel-tax-class';
import { occupancyProblem } from './pricing.util';
import { loadPricing, priceWith } from './stay-pricing';
import { parseDay, stayProblem, todayInKenya } from './room-availability.util';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export interface HotelRules {
  cancelFreeDays: number;
  cancelKeepPercent: number;
  nightAuditHour: number;
  noShowCutoffHour: number;
  confirmationSms: boolean;
  reminderSms: boolean;
  thankYouSms: boolean;
}

const DEFAULT_RULES: HotelRules = {
  cancelFreeDays: 2,
  cancelKeepPercent: 0,
  nightAuditHour: 3,
  noShowCutoffHour: 18,
  confirmationSms: true,
  reminderSms: true,
  thankYouSms: true,
};

/** The hotel's own rules (cancellation, night audit hour, which texts to send); defaults until it sets them. */
export async function loadRules(tx: TenantTx): Promise<HotelRules> {
  const row = await tx.hotelSetting.findFirst();
  if (!row) return DEFAULT_RULES;
  return {
    cancelFreeDays: row.cancelFreeDays,
    cancelKeepPercent: row.cancelKeepPercent,
    nightAuditHour: row.nightAuditHour,
    noShowCutoffHour: row.noShowCutoffHour,
    confirmationSms: row.confirmationSms,
    reminderSms: row.reminderSms,
    thankYouSms: row.thankYouSms,
  };
}

/** Rate plans, room taxes and the hotel's rules: set by a manager, read by the desk. */
@Injectable()
export class HotelSettingsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ── Rules ──────────────────────────────────────────────────────────────

  settings(): Promise<HotelRules> {
    return this.tenantPrisma.run((tx) => loadRules(tx));
  }

  async updateSettings(dto: HotelSettingsDto): Promise<HotelRules> {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const before = await loadRules(tx);
      await tx.hotelSetting.upsert({
        where: { organizationId },
        create: { organizationId, ...dto },
        update: dto,
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.settings_updated',
        entityType: 'HotelSetting',
        entityId: organizationId,
        before,
        after: dto,
      });
      return loadRules(tx);
    });
  }

  // ── Taxes ──────────────────────────────────────────────────────────────

  taxes() {
    return this.tenantPrisma.run(async (tx) =>
      (
        await tx.hotelTax.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        })
      ).map((t) => ({
        id: t.id,
        name: t.name,
        percent: Number(t.percent),
        isActive: t.isActive,
      })),
    );
  }

  /** Replaces the list of room taxes. The room products then carry the combined rate, so the sale at check-out is right. */
  async setTaxes(dto: TaxesDto) {
    const { organizationId } = getTenantStore();
    const names = dto.taxes.map((t) => t.name.toLowerCase());
    if (new Set(names).size !== names.length)
      throw new BadRequestException('Two taxes have the same name');
    if (
      dto.taxes.reduce(
        (s, t) => s + (t.isActive === false ? 0 : t.percent),
        0,
      ) > 100
    )
      throw new BadRequestException('The taxes add up to more than 100%');
    await this.tenantPrisma.run(async (tx) => {
      const before = await tx.hotelTax.findMany();
      await tx.hotelTax.deleteMany({});
      for (const [i, t] of dto.taxes.entries())
        await tx.hotelTax.create({
          data: {
            organizationId,
            name: t.name,
            percent: t.percent,
            isActive: t.isActive ?? true,
            sortOrder: i,
          },
        });
      const active = dto.taxes.filter(
        (t) => t.isActive !== false && t.percent > 0,
      );
      if (active.length > 0) await applyManagedTaxClass(tx, organizationId);
      else {
        // no room taxes any more: the managed class (if it was ever made) stops charging anything
        const managed = await tx.taxClass.findFirst({
          where: { name: MANAGED_TAX_CLASS_NAME },
        });
        if (managed)
          await tx.taxClass.update({
            where: { id: managed.id },
            data: { rate: 0 },
          });
      }
      await this.auditLog.logInTx(tx, {
        action: 'hotel.taxes_updated',
        entityType: 'HotelTax',
        entityId: organizationId,
        before: before.map((t) => ({
          name: t.name,
          percent: Number(t.percent),
          isActive: t.isActive,
        })),
        after: dto.taxes,
      });
    });
    return this.taxes();
  }

  // ── Quote ──────────────────────────────────────────────────────────────

  /** What a stay would cost at the desk: each night, then the taxes on top. Same function as booking and the marketplace quote. */
  async quote(dto: QuoteDto) {
    const checkIn = parseDay(dto.checkIn);
    const checkOut = parseDay(dto.checkOut);
    const problem = stayProblem(checkIn, checkOut, todayInKenya());
    if (problem) throw new BadRequestException(problem);
    const children = dto.children ?? 0;
    if (children >= dto.guests)
      throw new BadRequestException('At least one adult is needed');
    return this.tenantPrisma.run(async (tx) => {
      const rt = await tx.hotelRoomType.findFirst({
        where: { id: dto.roomTypeId, isActive: true },
      });
      if (!rt) throw new NotFoundException('That room type is not available');
      const adults = dto.guests - children;
      const tooMany = occupancyProblem(
        { rooms: dto.rooms, adults, children },
        rt.maxGuests,
      );
      if (tooMany) throw new BadRequestException(tooMany);
      const price = priceWith(await loadPricing(tx, rt), {
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        rooms: dto.rooms,
        adults,
        children,
        mealPlan: dto.mealPlan ?? 'ROOM_ONLY',
        rate: dto.rate,
      });
      const lines = await activeTaxLines(tx);
      const posted = nightPostings(
        price.nights.map((n) => n.total),
        lines,
      );
      const tax =
        Math.round(
          posted.reduce((s, p) => s + Math.round(p.taxAmount * 100), 0),
        ) / 100;
      return {
        nights: price.nights.map((n, i) => ({
          ...n,
          tax: posted[i].taxAmount,
        })),
        subtotal: price.total,
        roomTotal: price.roomTotal,
        extraTotal: price.extraTotal,
        mealTotal: price.mealTotal,
        taxes: lines.map((l) => ({
          name: l.name,
          percent: l.percent,
          amount:
            Math.round(
              posted.reduce((s, p) => s + (p.breakdown[l.name] ?? 0) * 100, 0),
            ) / 100,
        })),
        tax,
        total: Math.round((price.total + tax) * 100) / 100,
        combinedTaxRate: combinedRate(lines),
        averageRate: price.averageRate,
      };
    });
  }

  // ── Rate plans ─────────────────────────────────────────────────────────

  private async roomType(tx: TenantTx, id: string) {
    const rt = await tx.hotelRoomType.findUnique({ where: { id } });
    if (!rt) throw new NotFoundException('Room type not found');
    return rt;
  }

  /** A room type's whole price list as the screen shows it. */
  async rates(roomTypeId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rt = await this.roomType(tx, roomTypeId);
      const p = await loadPricing(tx, rt);
      const seasons = await tx.hotelSeason.findMany({
        where: { roomTypeId },
        orderBy: { startDate: 'asc' },
      });
      return {
        roomTypeId,
        name: rt.name,
        baseRate: p.card.baseRate,
        weekendRate: p.card.weekendRate,
        weekendDays: p.card.weekendDays,
        includedAdults: p.card.includedAdults,
        freeChildren: p.card.freeChildren,
        extraAdultRate: p.card.extraAdultRate,
        extraChildRate: p.card.extraChildRate,
        seasons: seasons.map((s) => ({
          id: s.id,
          name: s.name,
          startDate: iso(s.startDate),
          endDate: iso(s.endDate),
          rate: Number(s.rate),
          weekendRate: s.weekendRate != null ? Number(s.weekendRate) : null,
        })),
        meals: MEAL_PLANS.filter((m) => m.key !== 'ROOM_ONLY').map((m) => ({
          plan: m.key,
          label: m.label,
          adultPrice: p.meals[m.key]?.adult ?? 0,
          childPrice: p.meals[m.key]?.child ?? 0,
        })),
      };
    });
  }

  async setRateCard(roomTypeId: string, dto: RateCardDto) {
    const { organizationId } = getTenantStore();
    if (new Set(dto.weekendDays).size !== dto.weekendDays.length)
      throw new BadRequestException('A weekend day is listed twice');
    await this.tenantPrisma.run(async (tx) => {
      await this.roomType(tx, roomTypeId);
      const data = {
        weekendRate: dto.weekendRate ?? null,
        weekendDays: dto.weekendDays,
        includedAdults: dto.includedAdults,
        freeChildren: dto.freeChildren,
        extraAdultRate: dto.extraAdultRate,
        extraChildRate: dto.extraChildRate,
      };
      await tx.hotelRateCard.upsert({
        where: { roomTypeId },
        create: { organizationId, roomTypeId, ...data },
        update: data,
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.rate_card_updated',
        entityType: 'HotelRoomType',
        entityId: roomTypeId,
        after: data,
      });
    });
    return this.rates(roomTypeId);
  }

  async addSeason(roomTypeId: string, dto: SeasonDto) {
    const { organizationId } = getTenantStore();
    if (dto.endDate < dto.startDate)
      throw new BadRequestException('A season cannot end before it starts');
    await this.tenantPrisma.run(async (tx) => {
      await this.roomType(tx, roomTypeId);
      const season = await tx.hotelSeason.create({
        data: {
          organizationId,
          roomTypeId,
          name: dto.name,
          startDate: day(dto.startDate),
          endDate: day(dto.endDate),
          rate: dto.rate,
          weekendRate: dto.weekendRate ?? null,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.season_added',
        entityType: 'HotelSeason',
        entityId: season.id,
        after: dto,
      });
    });
    return this.rates(roomTypeId);
  }

  async removeSeason(roomTypeId: string, seasonId: string) {
    await this.tenantPrisma.run(async (tx) => {
      const season = await tx.hotelSeason.findFirst({
        where: { id: seasonId, roomTypeId },
      });
      if (!season) throw new NotFoundException('Season not found');
      await tx.hotelSeason.delete({ where: { id: seasonId } });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.season_removed',
        entityType: 'HotelSeason',
        entityId: seasonId,
        before: {
          name: season.name,
          startDate: iso(season.startDate),
          endDate: iso(season.endDate),
          rate: Number(season.rate),
        },
      });
    });
    return this.rates(roomTypeId);
  }

  async setMealPrices(roomTypeId: string, dto: MealPricesDto) {
    const { organizationId } = getTenantStore();
    const plans = dto.prices.map((p) => p.plan);
    if (plans.includes('ROOM_ONLY'))
      throw new BadRequestException('Room only has no meal price');
    if (new Set(plans).size !== plans.length)
      throw new BadRequestException('A meal plan is listed twice');
    await this.tenantPrisma.run(async (tx) => {
      await this.roomType(tx, roomTypeId);
      await tx.hotelMealPrice.deleteMany({ where: { roomTypeId } });
      for (const p of dto.prices)
        await tx.hotelMealPrice.create({
          data: {
            organizationId,
            roomTypeId,
            plan: p.plan,
            adultPrice: p.adultPrice,
            childPrice: p.childPrice,
          },
        });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.meal_prices_updated',
        entityType: 'HotelRoomType',
        entityId: roomTypeId,
        after: dto.prices,
      });
    });
    return this.rates(roomTypeId);
  }
}

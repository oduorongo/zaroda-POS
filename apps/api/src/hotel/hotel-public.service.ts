import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { ShopCatalogService } from '../online-orders/shop-catalog.service';
import { depositFor, nightsBetween, parseDay, stayProblem, stayTotal, todayInKenya } from './room-availability.util';
import { roomsLeft } from './room-stock';

export interface StayQuery {
  checkIn?: string;
  checkOut?: string;
  area?: string;
}

type RoomTypeWithPhotos = Prisma.HotelRoomTypeGetPayload<{ include: { photos: true } }>;

/** What guests see on the marketplace: hotels that are live and have rooms on offer. No sign-in. */
@Injectable()
export class HotelPublicService {
  constructor(
    private readonly catalog: ShopCatalogService,
    private readonly storage: ObjectStorageService,
  ) {}

  /** The dates, if they were given and make sense; a bad pair is simply ignored so the page still shows the hotels. */
  private stay(query: StayQuery) {
    const checkIn = parseDay(query.checkIn);
    const checkOut = parseDay(query.checkOut);
    return checkIn && checkOut && !stayProblem(checkIn, checkOut, todayInKenya()) ? { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut) } : null;
  }

  private listedRoomTypes(tx: TenantTx) {
    return tx.hotelRoomType.findMany({
      where: { isListed: true, isActive: true },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { pricePerNight: 'asc' },
    });
  }

  /** The marketplace's Hotels page. With dates, only hotels that still have a room for every night of the stay. */
  async listHotels(query: StayQuery) {
    const stay = this.stay(query);
    const needle = query.area?.trim().toLowerCase().slice(0, 80) ?? '';
    const hotels = await this.catalog.mapLiveShops(async (tx, shop) => {
      if (shop.hotelBlocked) return null;
      const roomTypes = await this.listedRoomTypes(tx);
      if (roomTypes.length === 0) return null;
      let available = roomTypes;
      if (stay) {
        const free = await Promise.all(roomTypes.map(async (rt) => (await roomsLeft(tx, rt, stay.checkIn, stay.checkOut)) > 0));
        available = roomTypes.filter((_, i) => free[i]);
        if (available.length === 0) return null;
      }
      const branch = await tx.branch.findUnique({ where: { id: shop.fulfilmentBranchId }, select: { county: true, subCounty: true } });
      const cover = available.flatMap((rt) => rt.photos).at(0);
      return {
        slug: shop.slug,
        name: shop.displayName,
        description: shop.description,
        county: branch?.county ?? null,
        subCounty: branch?.subCounty ?? null,
        coverImage: cover ? this.storage.publicUrl(cover.storageKey) : null,
        fromPrice: Math.min(...available.map((rt) => Number(rt.pricePerNight))),
        roomTypeCount: available.length,
      };
    });
    return needle ? hotels.filter((h) => [h.name, h.description, h.county, h.subCounty].some((v) => v?.toLowerCase().includes(needle))) : hotels;
  }

  private roomView(rt: RoomTypeWithPhotos, stay: { nights: number } | null, left: number | null) {
    const price = Number(rt.pricePerNight);
    const total = stay ? stayTotal(price, stay.nights, 1) : null;
    return {
      id: rt.id,
      name: rt.name,
      description: rt.description,
      amenities: (rt.amenities ?? '').split(',').map((a) => a.trim()).filter(Boolean),
      pricePerNight: price,
      maxGuests: rt.maxGuests,
      depositPercent: rt.depositPercent,
      images: rt.photos.map((p) => this.storage.publicUrl(p.storageKey)),
      // Only known once dates are chosen.
      roomsLeft: left,
      quote: total === null ? null : { nights: stay!.nights, total, deposit: depositFor(total, rt.depositPercent) },
    };
  }

  async getHotel(slug: string, query: StayQuery) {
    const stay = this.stay(query);
    return this.catalog.runForShop(slug, async (tx, shop) => {
      if (shop.hotelBlocked) throw new NotFoundException('This hotel has no rooms on offer right now');
      const roomTypes = await this.listedRoomTypes(tx);
      if (roomTypes.length === 0) throw new NotFoundException('This hotel has no rooms on offer right now');
      const branch = await tx.branch.findUnique({ where: { id: shop.fulfilmentBranchId }, select: { name: true, county: true, subCounty: true } });
      const lefts = stay ? await Promise.all(roomTypes.map((rt) => roomsLeft(tx, rt, stay.checkIn, stay.checkOut))) : roomTypes.map(() => null);
      return {
        slug: shop.slug,
        name: shop.displayName,
        description: shop.description,
        contactPhone: shop.contactPhone,
        location: branch ? { branchName: branch.name, county: branch.county, subCounty: branch.subCounty } : null,
        stay: stay ? { checkIn: query.checkIn, checkOut: query.checkOut, nights: stay.nights } : null,
        roomTypes: roomTypes.map((rt, i) => this.roomView(rt, stay, lefts[i])),
      };
    });
  }
}

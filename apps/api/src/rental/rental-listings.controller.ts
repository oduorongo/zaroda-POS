import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
  Patch,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { MAX_IMAGE_BYTES } from '../catalog/product-images.service';
import { CopyListingDto, PayListingDto, PayListingsDto, SetListingActiveDto, UpsertListingDto } from './dto/rental-listing.dto';
import { RentalListingPaymentsService } from './rental-listing-payments.service';
import { PublicHousesService } from './public-houses.service';
import { RentalListingsService } from './rental-listings.service';
import { RentalReadOnlyInterceptor } from './rental-read-only.interceptor';

const UPLOAD_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const PUBLIC_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/** A filter typed into the page: a number, or nothing. Anything unreadable is ignored rather than rejected. */
const optionalNumber = (value?: string): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Landlord side: manage the "Houses to let" adverts for vacant units. Owners and managers only. */
@Controller('rental')
@UseInterceptors(RentalReadOnlyInterceptor)
export class RentalListingsController {
  constructor(
    private readonly listings: RentalListingsService,
    private readonly payments: RentalListingPaymentsService,
  ) {}

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('listings')
  list() {
    return this.listings.list();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put('units/:unitId/listing')
  save(@Param('unitId', ParseUUIDPipe) unitId: string, @Body() dto: UpsertListingDto) {
    return this.listings.upsertForUnit(unitId, dto);
  }

  /** Sends an M-Pesa prompt for KES 100: 30 days of the advert, added on top of any time already left. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('listings/:id/pay')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayListingDto) {
    return this.payments.pay([id], dto.phone);
  }

  /** Creates adverts for other vacant units from this one's details (no photos, unpaid until paid for). */
  @Roles(Role.MANAGER, Role.OWNER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('listings/:id/copy')
  copy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CopyListingDto) {
    return this.listings.copyTo(id, dto);
  }

  /** One M-Pesa prompt for KES 100 per advert, for several adverts at once. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('listings/pay')
  payMany(@Body() dto: PayListingsDto) {
    return this.payments.pay(dto.listingIds, dto.phone);
  }

  /** Backup for a callback that never arrived: a rate-limited, paid Tuma status check. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Post('listings/:id/pay/check')
  checkPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.check(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('listings/:id')
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetListingActiveDto) {
    return this.listings.setActive(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete('listings/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.listings.remove(id);
  }

  /** The photo itself is the request body (Content-Type: image/jpeg|png|webp), same as product photos. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Throttle(UPLOAD_THROTTLE)
  @Post('listings/:id/photos')
  async addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('content-type') contentType: string | undefined,
    @Req() req: Request,
  ) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) throw new PayloadTooLargeException('Photos must be 5MB or smaller');
      chunks.push(chunk);
    }
    return this.listings.addPhoto(id, (contentType ?? '').split(';')[0].trim().toLowerCase(), Buffer.concat(chunks));
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('listings/:id/photos/:photoId/cover')
  makeCover(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.listings.makeCover(id, photoId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete('listings/:id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    await this.listings.removePhoto(id, photoId);
  }
}

/** Unauthenticated: what house-hunters see on the marketplace. */
@Controller('public/houses')
export class PublicHousesController {
  constructor(private readonly houses: PublicHousesService) {}

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get()
  list(
    @Query('area') area?: string,
    @Query('type') type?: string,
    @Query('minRent') minRent?: string,
    @Query('maxRent') maxRent?: string,
    @Query('page') page?: string,
  ) {
    return this.houses.list({ area, type, minRent: optionalNumber(minRent), maxRent: optionalNumber(maxRent), page: optionalNumber(page) });
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.houses.get(id);
  }
}

/**
 * Tuma's payment webhook for an advert payment. Authenticated by the HMAC in the URL, and even then only trusted once
 * the body is complete and consistent - see RentalListingPaymentsService.handleTumaCallback.
 */
@Controller('public/rental-listing-payments')
export class RentalListingCallbackController {
  constructor(private readonly payments: RentalListingPaymentsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':organizationId/:paymentId/tuma-callback/:token')
  @HttpCode(200)
  callback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Param('token') token: string,
    // Tuma's real payload has fields we do not model, so this stays untyped
    // (a class would be rejected by the global forbidNonWhitelisted pipe).
    @Body() body: Record<string, unknown>,
  ) {
    return this.payments.handleTumaCallback(organizationId, paymentId, token, body);
  }
}
